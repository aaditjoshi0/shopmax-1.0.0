var express = require('express');
var router = express.Router();
var { supabase, MODE, getServiceClient } = require('../../config/supabase');
var store = require('../db/localStore');
var { getUser, requireUser } = require('../middleware/auth');
var paymentService = require('../services/payment');

// POST /api/payment/process — validate + simulate payment
// Returns payment result object; order is NOT created here.
router.post('/process', getUser, requireUser, async function (req, res, next) {
  try {
    var method = req.body.method || '';
    var payload = req.body.payload || {};
    var amount = parseFloat(req.body.amount) || 0;

    if (!method) {
      return res.status(400).json({ success: false, error: 'Payment method is required.' });
    }

    if (method !== 'cod' && amount <= 0 && method !== 'qr') {
      return res.status(400).json({ success: false, error: 'Amount must be greater than 0.' });
    }

    var result = await paymentService.processPayment(method, Object.assign({}, payload, { amount: amount }));

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /api/payment/demo-cards — expose test cards to the frontend
router.get('/demo-cards', function (req, res) {
  res.json({
    cards: [
      { type: 'Visa',       number: '4242 4242 4242 4242', expiry: '12/30', cvv: '123' },
      { type: 'Mastercard', number: '5555 5555 5555 4444', expiry: '11/30', cvv: '123' },
      { type: 'RuPay',      number: '6521 3456 7890 1234', expiry: '10/30', cvv: '123' }
    ],
    net_banks: ['SBI', 'HDFC', 'ICICI', 'Axis', 'Kotak', 'BOB', 'PNB'],
    wallets: ['Paytm Wallet', 'Amazon Pay', 'Mobikwik'],
    upi_handlers: paymentService.DEMO_UPI_HANDLES
  });
});

module.exports = router;