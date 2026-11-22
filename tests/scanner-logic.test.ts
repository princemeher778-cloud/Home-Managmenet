import test from 'node:test'
import assert from 'node:assert/strict'
import { parseUpiPaymentString } from '../src/utils/scanner.ts'

test('UPI Scanner Parser Invariants & Fallbacks', async (t) => {
  await t.test('1. Parses full standard UPI URI with amount, payee name, and note', () => {
    const uri = 'upi://pay?pa=arjun.verma@okhdfcbank&pn=Arjun%20Verma&am=5000&cu=INR&tn=Household%20Fund%20Contribution'
    const result = parseUpiPaymentString(uri)

    assert.equal(result.recipientName, 'Arjun Verma')
    assert.equal(result.upiId, 'arjun.verma@okhdfcbank')
    assert.equal(result.amountRupees, '5000')
    assert.equal(result.note, 'Household Fund Contribution')
  })

  await t.test('2. Handles plus-separated URL encoded spaces in payee name and note', () => {
    const uri = 'upi://pay?pa=household.treasury@icici&pn=Arjun+Verma&am=2500.50&tn=Electricity+Bill+Share'
    const result = parseUpiPaymentString(uri)

    assert.equal(result.recipientName, 'Arjun Verma')
    assert.equal(result.upiId, 'household.treasury@icici')
    assert.equal(result.amountRupees, '2500.50')
    assert.equal(result.note, 'Electricity Bill Share')
  })

  await t.test('3. Handles plain UPI VPA identifier', () => {
    const vpa = 'custodian.home@axisbank'
    const result = parseUpiPaymentString(vpa)

    assert.equal(result.recipientName, 'UPI Payee')
    assert.equal(result.upiId, 'custodian.home@axisbank')
    assert.equal(result.amountRupees, '5000')
  })

  await t.test('4. Handles non-standard / malformed strings gracefully without crashing', () => {
    const malformed = 'random_qr_data_string_12345'
    const result = parseUpiPaymentString(malformed)

    assert.equal(result.recipientName, 'Household Recipient')
    assert.equal(result.upiId, 'random_qr_data_string_12345')
    assert.equal(result.amountRupees, '5000')
  })
})
