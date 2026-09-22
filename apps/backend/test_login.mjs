#!/usr/bin/env node
import fetch from 'node-fetch';

async function testLogin() {
  try {
    console.log('🧪 Testing superadmin login endpoint...\n');
    
    const response = await fetch('http://localhost:5000/api/auth/login-superadmin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newadmin@jjelotech.local',
        password: 'NewAdmin123!@#'
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
