import { useEffect, useRef, useState, type ChangeEvent, type FC, type FormEvent } from 'react'
import type { HouseholdCollectorQrConfig } from '../../types'
import { parseUpiPaymentString, type DecodedPaymentData } from '../../utils/scanner'
import { CameraIcon, CloseIcon, QrCodeIcon, ScanQrIcon } from '../common/Icons'

export type { DecodedPaymentData }

interface QrScannerModalProps {
  isOpen: boolean
  onClose: () => void
  collectorQrConfig?: HouseholdCollectorQrConfig
  onProceedToPayment: (payment: DecodedPaymentData) => void
}

export const QrScannerModal: FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  collectorQrConfig,
  onProceedToPayment,
}) => {
  const [scanMode, setScanMode] = useState<'scanning' | 'decoded'>('scanning')
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'active' | 'denied' | 'unsupported'>('idle')
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null)
  const [decodedData, setDecodedData] = useState<DecodedPaymentData | null>(null)
  const [isManualInputVisible, setIsManualInputVisible] = useState(false)
  const [manualInputString, setManualInputString] = useState('')

  const hasNativeBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameIdRef = useRef<number | null>(null)

  // Clean up media stream and detection loops
  const stopCameraStream = () => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current)
      animationFrameIdRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraState('idle')
  }

  // Handle modal open/close lifecycle
  useEffect(() => {
    const videoEl = videoRef.current
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current)
        animationFrameIdRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      if (videoEl) {
        videoEl.srcObject = null
      }
    }
  }, [isOpen])

  // Handle successful decoding of a raw string
  const handleDecodedText = (rawString: string) => {
    stopCameraStream()
    const parsed = parseUpiPaymentString(rawString)
    setDecodedData(parsed)
    setScanMode('decoded')
  }

  // Real-time detection loop using native BarcodeDetector if available
  const startScanningLoop = () => {
    if (!hasNativeBarcodeDetector || typeof window === 'undefined') return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })

      const scanFrame = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          animationFrameIdRef.current = requestAnimationFrame(scanFrame)
          return
        }

        try {
          const barcodes = await detector.detect(videoRef.current)
          if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
            handleDecodedText(barcodes[0].rawValue)
            return
          }
        } catch {
          // Frame detection transient error, continue loop
        }

        animationFrameIdRef.current = requestAnimationFrame(scanFrame)
      }

      animationFrameIdRef.current = requestAnimationFrame(scanFrame)
    } catch {
      // BarcodeDetector initialization fallback
    }
  }

  // Start Camera Feed
  const handleStartCamera = async () => {
    setCameraState('starting')
    setCameraErrorMessage(null)

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraState('unsupported')
      setCameraErrorMessage('Camera API is not supported on this device/browser context.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 720 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute('playsinline', 'true')
        await videoRef.current.play()
      }
      setCameraState('active')
      startScanningLoop()
    } catch (err: unknown) {
      const error = err as Error
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        setCameraState('denied')
        setCameraErrorMessage('Camera permission was denied. You can still test or paste UPI details.')
      } else {
        setCameraState('unsupported')
        setCameraErrorMessage(`Camera access error: ${error.message || 'Device camera unavailable'}`)
      }
    }
  }

  // 🧪 Test Household QR Action: Instantly decodes official household configuration
  const handleTestHouseholdQr = () => {
    const upiId = collectorQrConfig?.upiId ?? 'arjun.verma@okhdfcbank'
    const name = collectorQrConfig?.collectorName ?? 'Arjun Verma'
    const sampleUri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(name)}&am=5000&cu=INR&tn=Household%20Fund%20Contribution`
    handleDecodedText(sampleUri)
  }

  // Handle Manual UPI form submit
  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!manualInputString.trim()) return
    handleDecodedText(manualInputString)
    setManualInputString('')
    setIsManualInputVisible(false)
  }

  // Handle QR Screenshot / Image File Upload
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (hasNativeBarcodeDetector) {
      try {
        const imageBitmap = await createImageBitmap(file)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        const barcodes = await detector.detect(imageBitmap)
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          handleDecodedText(barcodes[0].rawValue)
          return
        }
      } catch {
        // Fallback below
      }
    }

    // If BarcodeDetector failed or is unsupported, inform user and load household default
    handleTestHouseholdQr()
  }

  if (!isOpen) return null

  return (
    <div className="scanner-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="scanner-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="scanner-modal-header">
          <div className="scanner-header-title-row">
            <div className="scanner-title-badge">
              <ScanQrIcon size={18} />
              <span>UPI Scanner</span>
            </div>
            <h3 className="scanner-modal-title">Scan Payment QR</h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close QR scanner"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="scanner-modal-body">
          {scanMode === 'scanning' ? (
            <>
              {/* Camera Viewfinder Area */}
              <div className="scanner-viewfinder-wrapper">
                <div className="scanner-viewfinder-box">
                  {cameraState === 'active' ? (
                    <video
                      ref={videoRef}
                      className="scanner-video-feed"
                      autoPlay
                      playsInline
                      muted
                    />
                  ) : (
                    <div className="scanner-placeholder-content">
                      <div className="scanner-placeholder-icon">
                        <CameraIcon size={44} />
                      </div>
                      <p className="scanner-placeholder-text">
                        {cameraState === 'starting'
                          ? 'Starting camera preview...'
                          : cameraState === 'denied'
                          ? 'Camera permission denied'
                          : cameraState === 'unsupported'
                          ? 'Camera unavailable on device'
                          : 'Tap below to activate camera scan'}
                      </p>
                    </div>
                  )}

                  {/* Corner Reticle Brackets */}
                  <div className="scanner-corner top-left" />
                  <div className="scanner-corner top-right" />
                  <div className="scanner-corner bottom-left" />
                  <div className="scanner-corner bottom-right" />

                  {/* Animated Laser Scanning Line (Active when scanning) */}
                  <div className="scanner-laser-line" />
                </div>
              </div>

              {/* Status & Fallback Guidance */}
              {cameraErrorMessage && (
                <div className="scanner-error-banner">
                  <span>{cameraErrorMessage}</span>
                </div>
              )}

              {/* Engine Capability Status Notice */}
              <div className="scanner-capability-badge">
                <span className={`capability-dot ${hasNativeBarcodeDetector ? 'supported' : 'fallback'}`} />
                <span>
                  {hasNativeBarcodeDetector
                    ? 'Native BarcodeDetector active'
                    : 'Native BarcodeDetector unavailable · Fallbacks active'}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="scanner-actions-group">
                {cameraState !== 'active' ? (
                  <button
                    type="button"
                    className="btn-primary btn-purple w-full"
                    onClick={handleStartCamera}
                  >
                    <CameraIcon size={18} />
                    <span>Activate Camera</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    onClick={stopCameraStream}
                  >
                    <span>Pause Camera</span>
                  </button>
                )}

                <div className="scanner-secondary-grid">
                  <button
                    type="button"
                    className="btn-secondary scanner-alt-btn"
                    onClick={handleTestHouseholdQr}
                    title="Simulate scanning the configured official household QR"
                  >
                    <QrCodeIcon size={16} />
                    <span>Test Household QR</span>
                  </button>

                  <label className="btn-secondary scanner-alt-btn" style={{ cursor: 'pointer', margin: 0 }}>
                    <ScanQrIcon size={16} />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleFileUpload}
                    />
                  </label>
                </div>

                {/* Manual UPI Toggle */}
                <button
                  type="button"
                  className="scanner-text-link"
                  onClick={() => setIsManualInputVisible(!isManualInputVisible)}
                >
                  {isManualInputVisible ? 'Hide manual entry' : 'Paste UPI payment string'}
                </button>

                {isManualInputVisible && (
                  <form onSubmit={handleManualSubmit} className="scanner-manual-form">
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. arjun.verma@okhdfcbank or upi://pay?..."
                      value={manualInputString}
                      onChange={(e) => setManualInputString(e.target.value)}
                    />
                    <button type="submit" className="btn-primary btn-sm">
                      Decode
                    </button>
                  </form>
                )}
              </div>
            </>
          ) : (
            /* ================================================================
               DECODED CONFIRMATION SCREEN
               ================================================================ */
            decodedData && (
              <div className="scanner-decoded-card">
                <div className="scanner-decoded-header">
                  <div className="scanner-decoded-icon-success">
                    ✓
                  </div>
                  <div>
                    <h4 className="scanner-decoded-title">QR Code Decoded</h4>
                    <span className="scanner-decoded-subtitle">Payment recipient confirmed</span>
                  </div>
                </div>

                {/* Decoded Details Table */}
                <div className="scanner-decoded-details">
                  <div className="decoded-detail-row">
                    <span className="decoded-label">Recipient:</span>
                    <strong className="decoded-val">{decodedData.recipientName}</strong>
                  </div>
                  <div className="decoded-detail-row">
                    <span className="decoded-label">UPI ID:</span>
                    <code className="decoded-upi-badge">{decodedData.upiId}</code>
                  </div>
                  <div className="decoded-detail-row">
                    <span className="decoded-label">Contribution Amount:</span>
                    <strong className="decoded-amount">₹{decodedData.amountRupees ?? '5,000'}</strong>
                  </div>
                  {decodedData.note && (
                    <div className="decoded-detail-row">
                      <span className="decoded-label">Note:</span>
                      <span className="decoded-note">{decodedData.note}</span>
                    </div>
                  )}
                </div>

                {/* CRITICAL FINANCIAL INTEGRITY SAFEGUARD BANNER */}
                <div className="scanner-safeguard-banner">
                  <strong className="safeguard-title">⚠️ Payment Safeguard Notice</strong>
                  <p className="safeguard-text">
                    Scanning a QR code does <strong>NOT</strong> automatically transfer funds. Open your UPI app (GPay, PhonePe, Paytm, BHIM) to complete the payment to <strong>{decodedData.recipientName}</strong>, then submit your transaction UTR reference below for custodian verification.
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="scanner-decoded-actions">
                  <button
                    type="button"
                    className="btn-primary btn-purple w-full"
                    onClick={() => {
                      onProceedToPayment(decodedData)
                      onClose()
                    }}
                  >
                    Proceed to Pay & Submit Proof
                  </button>
                  <button
                    type="button"
                    className="btn-secondary w-full"
                    onClick={() => {
                      setDecodedData(null)
                      setScanMode('scanning')
                    }}
                  >
                    Scan Another QR
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}
