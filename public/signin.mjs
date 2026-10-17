const form = document.getElementById('signinForm');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button'), status = document.getElementById('signinStatus');
  button.disabled = true; status.textContent = '正在连接…';
  try {
    const response = await fetch('/api/access/login', { method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:document.getElementById('password').value}), signal:AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '暂时无法登录');
    document.getElementById('password').value = '';
    location.replace('/');
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
