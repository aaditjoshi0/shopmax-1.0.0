// ShopMax Payment Service
// Architecture: All payment processing goes through this service.
// To replace with a real gateway (Razorpay, Stripe, PhonePe, Cashfree, PayPal),
// only change the implementation of these functions — no checkout changes needed.

var crypto = require('crypto');

var DEMO_CARDS = {
  visa:       { number: '4242424242424242', expiry: '12/30', cvv: '123' },
  mastercard: { number: '5555555555554444', expiry: '11/30', cvv: '123' },
  rupay:      { number: '6521345678901234', expiry: '10/30', cvv: '123' }
};

var DEMO_UPI_HANDLES = ['oksbi', 'okhdfcbank', 'okicici', 'okaxis', 'okpaytm', 'okamazonpay'];

var VALID_UPI_REGEX = /^[a-zA-Z0-9._+\-]{3,}@[a-zA-Z0-9._-]{3,}$/;
var CARD_NUMBER_REGEX = /^\d{16}$/;
var CVV_REGEX = /^\d{3}$/;
var PHONE_REGEX = /^\d{10}$/;

function generateTransactionId() {
  return 'TXN' + Date.now() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function maskCardNo(number) {
  var cleaned = String(number || '').replace(/\s/g, '');
  return '**** **** **** ' + cleaned.slice(-4);
}

function validateUPI(upiId) {
  if (!upiId || !VALID_UPI_REGEX.test(upiId.trim())) {
    return { valid: false, error: 'Invalid UPI ID format. Expected format: abc@oksbi' };
  }
  return { valid: true };
}

function validateCard(payload) {
  var errors = {};
  var num = (payload.card_number || '').replace(/\s/g, '');
  if (!VALID_CARD_NUMBER_REGEX.test(num)) {
    errors.card_number = 'Invalid card number. Must be exactly 16 digits.';
  }
  if (!payload.card_holder || !/^[a-zA-Z\s]+$/.test(payload.card_holder.trim()) || payload.card_holder.trim().length < 2) {
    errors.card_holder = 'Invalid card holder name. Only alphabets allowed.';
  }
  if (!payload.expiry || !/^(0[1-9]|1[0-2])\/(\d{2})$/.test(payload.expiry.trim())) {
    errors.expiry = 'Invalid expiry date. Format: MM/YY';
  } else {
    var parts = payload.expiry.split('/');
    var month = parseInt(parts[0], 10);
    var year = parseInt('20' + parts[1], 10);
    var expDate = new Date(year, month, 0);
    if (expDate < new Date()) {
      errors.expiry = 'Card has expired.';
    }
  }
  if (!payload.cvv || !CVV_REGEX.test(String(payload.cvv).trim())) {
    errors.cvv = 'Invalid CVV. Must be 3 digits.';
  }
  if (Object.keys(errors).length > 0) {
    return { valid: false, errors: errors };
  }
  return { valid: true, last4: num.slice(-4), card_type: detectCardType(num) };
}

function validatePhone(phone) {
  if (!phone || !PHONE_REGEX.test(String(phone).trim())) {
    return { valid: false, error: 'Invalid phone number. Must be exactly 10 digits.' };
  }
  return { valid: true };
}

function detectCardType(number) {
  var n = String(number || '').replace(/\s/g, '');
  if (/^4/.test(n)) return 'Visa';
  if (/^5[1-5]/.test(n)) return 'Mastercard';
  if (/^6/.test(n)) return 'RuPay';
  if (/^3[47]/.test(n)) return 'Amex';
  return 'Unknown';
}

// === PROCESS PAYMENT (Demo/Test Mode) ===
// Replace the body of this function to integrate an actual payment gateway.

function processPayment(method, payload) {
  var txnId = generateTransactionId();
  var now = new Date().toISOString();
  var amount = payload.amount || 0;

  // ===== UPI =====
  if (method === 'upi') {
    if (!payload.upi_id) {
      return Promise.resolve({ success: false, error: 'UPI ID is required.' });
    }
    var upiValidation = validateUPI(payload.upi_id);
    if (!upiValidation.valid) {
      return Promise.resolve({ success: false, error: upiValidation.error });
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          success: true,
          transaction_id: txnId,
          gateway: 'Demo UPI',
          method: 'upi',
          upi_id: payload.upi_id.toLowerCase(),
          amount: amount,
          timestamp: now
        });
      }, 1000);
    });
  }

  // ===== QR Code (Scan & Pay) =====
  if (method === 'qr') {
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          success: true,
          transaction_id: txnId,
          gateway: 'Demo QR',
          method: 'qr',
          amount: amount,
          timestamp: now
        });
      }, 1000);
    });
  }

  // ===== Credit Card / Debit Card =====
  if (method === 'credit_card' || method === 'debit_card' || method === 'card') {
    var cardValidation = validateCard(payload);
    if (!cardValidation.valid) {
      return Promise.resolve({ success: false, error: 'Card validation failed.', errors: cardValidation.errors });
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          success: true,
          transaction_id: txnId,
          gateway: 'Demo Gateway',
          method: method,
          card_type: cardValidation.card_type,
          last4: cardValidation.last4,
          amount: amount,
          timestamp: now
        });
      }, 1000);
    });
  }

  // ===== Net Banking =====
  if (method === 'net_banking') {
    if (!payload.bank) {
      return Promise.resolve({ success: false, error: 'Please select a bank.' });
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          success: true,
          transaction_id: txnId,
          gateway: 'Demo NetBanking',
          method: 'net_banking',
          bank: payload.bank,
          amount: amount,
          timestamp: now
        });
      }, 1000);
    });
  }

  // ===== Wallet =====
  if (method === 'wallet') {
    if (!payload.wallet_name) {
      return Promise.resolve({ success: false, error: 'Please select a wallet.' });
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          success: true,
          transaction_id: txnId,
          gateway: 'Demo Wallet',
          method: 'wallet',
          wallet_name: payload.wallet_name,
          mobile: payload.mobile || '',
          timestamp: now
        });
      }, 1000);
    });
  }

  // ===== Cash on Delivery =====
  if (method === 'cod') {
    return Promise.resolve({
      success: true,
      transaction_id: txnId,
      gateway: 'COD',
      method: 'cod',
      timestamp: now,
      is_cod: true
    });
  }

  return Promise.resolve({ success: false, error: 'Unknown payment method.' });
}

// Format payment status for display
function paymentStatusLabel(status) {
  // This is used for admin panel / order display
}

module.exports = {
  DEMO_CARDS: DEMO_CARDS,
  DEMO_UPI_HANDLES: DEMO_UPI_HANDLES,
  validateUPI: validateUPI,
  validateCard: validateCard,
  validatePhone: validatePhone,
  maskCardNo: maskCardNo,
  processPayment: processPayment
};