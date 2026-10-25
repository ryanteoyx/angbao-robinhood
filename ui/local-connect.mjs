// Pairing nonce is single use. Only a bounded session proof enters sessionStorage.
const form=document.querySelector('#connect'),status=document.querySelector('#status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{
    const file=document.querySelector('#pair').files[0];
    if(!file||file.size>16384)throw Error();
    const text=await file.text(),pair=JSON.parse(text);
    if(pair.format!=='angbao-local-browser-pair@1'||pair.origin!==location.origin||typeof pair.nonce!=='string'||!Number.isFinite(Date.parse(pair.expiresAt))||Date.parse(pair.expiresAt)<=Date.now()||Object.keys(pair).sort().join(',')!=='expiresAt,format,nonce,origin')throw Error();
    status.textContent='Connecting to your saved workspace…';
    const response=await fetch('/api/local/browser/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pair),credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error();
    const session=await response.json();if(typeof session.proof!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(session.proof)||session.readOnly!==true)throw Error();
    sessionStorage.setItem('angbao-local-proof',session.proof);document.querySelector('#pair').value='';location.replace('/');
  }catch{status.textContent='This connection file could not be accepted. Ask your agent for a new file for this workspace, then choose it again. Your saved work is unchanged.';}
  finally{button.disabled=false;}
});
