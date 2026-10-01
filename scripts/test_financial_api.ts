async function test() {
  try {
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vetrivel.com', password: 'admin123' })
    });
    const loginData = await loginRes.json() as any;
    console.log('Login status:', loginRes.status, 'Token:', loginData.token ? 'YES' : 'NO');

    const res = await fetch('http://localhost:5000/api/financial-dashboard/summary', {
      headers: { 'Authorization': 'Bearer ' + loginData.token }
    });
    console.log('Financial dashboard summary status:', res.status);
    const data = await res.json();
    console.log('Summary data:', JSON.stringify(data).slice(0, 300));
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}
test();
