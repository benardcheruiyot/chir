// Test script for local STK push endpoint
const axios = require('axios');

async function testStkPush() {
  const url = 'http://localhost:1000/api/haskback_push'; // Change port if needed
  const payload = {
    msisdn: '254700000001',
    amount: 1,
    reference: 'TEST_REF_001'
  };
  try {
    const res = await axios.post(url, payload);
    console.log('STK push response:', res.data);
  } catch (err) {
    if (err.response) {
      console.error('Error response:', err.response.data);
    } else {
      console.error('Request error:', err.message);
    }
  }
}

testStkPush();
