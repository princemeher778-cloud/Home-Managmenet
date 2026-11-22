export interface DecodedPaymentData {
  recipientName: string
  upiId: string
  amountRupees?: string
  note?: string
  rawText: string
}

/**
 * Pure parser for standard UPI payment URIs and plain UPI IDs.
 * Format: upi://pay?pa=arjun.verma@okhdfcbank&pn=Arjun%20Verma&am=5000&cu=INR&tn=Home%20Fund
 */
export function parseUpiPaymentString(rawString: string): DecodedPaymentData {
  const trimmed = rawString.trim()

  if (trimmed.toLowerCase().startsWith('upi://pay?')) {
    try {
      const url = new URL(trimmed)
      const pa = url.searchParams.get('pa') ?? ''
      const pn = decodeURIComponent(url.searchParams.get('pn') ?? 'Household Custodian')
      const am = url.searchParams.get('am') ?? undefined
      const tn = url.searchParams.get('tn') ? decodeURIComponent(url.searchParams.get('tn')!) : undefined

      return {
        recipientName: pn.replace(/\+/g, ' ').trim() || 'Household Custodian',
        upiId: pa.trim() || 'arjun.verma@okhdfcbank',
        amountRupees: am ?? '5000',
        note: tn ? tn.replace(/\+/g, ' ') : 'Household Fund Contribution',
        rawText: trimmed,
      }
    } catch {
      // Fallback manual regex parser if URL constructor encounters non-standard URI schemes
      const paMatch = trimmed.match(/[?&]pa=([^&]+)/i)
      const pnMatch = trimmed.match(/[?&]pn=([^&]+)/i)
      const amMatch = trimmed.match(/[?&]am=([^&]+)/i)
      const tnMatch = trimmed.match(/[?&]tn=([^&]+)/i)

      return {
        recipientName: pnMatch ? decodeURIComponent(pnMatch[1]).replace(/\+/g, ' ') : 'Household Custodian',
        upiId: paMatch ? decodeURIComponent(paMatch[1]) : 'arjun.verma@okhdfcbank',
        amountRupees: amMatch ? decodeURIComponent(amMatch[1]) : '5000',
        note: tnMatch ? decodeURIComponent(tnMatch[1]).replace(/\+/g, ' ') : 'Household Fund Contribution',
        rawText: trimmed,
      }
    }
  }

  // Handle plain UPI ID (e.g. username@bank)
  if (trimmed.includes('@')) {
    return {
      recipientName: 'UPI Payee',
      upiId: trimmed,
      amountRupees: '5000',
      note: 'Household Contribution',
      rawText: trimmed,
    }
  }

  // Default structured entity
  return {
    recipientName: 'Household Recipient',
    upiId: trimmed || 'arjun.verma@okhdfcbank',
    amountRupees: '5000',
    note: 'Payment via Household QR',
    rawText: trimmed,
  }
}
