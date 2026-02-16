require('dotenv').config();
const axios = require('axios');

async function run(){
  try{
    const url = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000') + '/api/debug/echo';
    const payload = { identifier: 'biggsadmin@test.app', password: 'Biggsadmin@123' };
    console.log('POST', url, 'payload=', payload);
    const res = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, withCredentials: true });
    console.log('Status:', res.status);
    console.log('Body:', res.data);
  } catch(e){
    if (e.response) {
      console.error('Status:', e.response.status);
      console.error('Body:', e.response.data);
    } else {
      console.error('Error:', e.message);
    }
    process.exit(1);
  }
}

run();
