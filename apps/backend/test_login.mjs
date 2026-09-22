#!/usr/bin/env node
import fetch from 'node-fetch';

async function testLogin() {
  try {
    if (!process.env.SUPERADMIN_EMAIL || !process.env.SUPERADMIN_PASSWORD) {
      console.error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD before running this script.');
      process.exit(1);
    }

    console.log('🧪 Testing superadmin login endpoint...\n');
    
    const response = await fetch('http://localhost:5000/api/auth/login-superadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.SUPERADMIN_EMAIL,
        password: process.env.SUPERADMIN_PASSWORD
      })
    });
    
    const data = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response body:');
    console.log(JSON.stringify(data, null, 2));
    
    if (!response.ok) {
      console.log('\n❌ Login failed');
      process.exit(1);
    }
    
    if (data.user) {
      console.log('\n✅ Login successful');
      console.log('User role:', data.user.role);
      console.log('User email:', data.user.email);
      console.log('User platform:', data.user.platform);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testLogin();
