(function(){
  const config=window.SPOT_SUPABASE||{};
  const configured=Boolean(config.url&&config.anonKey);
  const loginView=document.querySelector('#loginView');
  const dashboardView=document.querySelector('#dashboardView');
  const productEditor=document.querySelector('#productEditor');
  const productForm=document.querySelector('#productForm');
  let session=null;
  let currentUser=null;
  let productCache=[];

  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const setStatus=(id,message,isError=false)=>{const el=document.querySelector(id);el.textContent=message;el.classList.toggle('error',isError)};
  const toast=message=>{const el=document.querySelector('#adminToast');el.textContent=message;el.classList.add('show');clearTimeout(window.adminToastTimer);window.adminToastTimer=setTimeout(()=>el.classList.remove('show'),2200)};
  const saveSession=value=>{session=value;if(value)localStorage.setItem('spot_admin_session',JSON.stringify(value));else localStorage.removeItem('spot_admin_session')};

  if(!configured){
    document.querySelector('#setupWarning').hidden=false;
    document.querySelector('#loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=true);
    return;
  }

  async function request(path,{method='GET',body,authenticated=true,headers={}}={}){
    const isFile=body instanceof Blob||body instanceof File;
    const response=await fetch(`${config.url}${path}`,{
      method,
      headers:{apikey:config.anonKey,...(authenticated&&session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{}),...(body!==undefined&&!isFile?{'Content-Type':'application/json'}:{}),...headers},
      body:body===undefined?undefined:(isFile?body:JSON.stringify(body))
    });
    const text=await response.text();let data=null;
    if(text){try{data=JSON.parse(text)}catch{data=text}}
    if(!response.ok)throw new Error(data?.message||data?.msg||`İşlem tamamlanamadı (${response.status})`);
    return data;
  }

  async function signIn(email,password){
    const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},authenticated:false});
    saveSession({...data,expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in||3600)});
  }

  async function refreshSession(){
    if(!session?.refresh_token)return false;
    try{
      const data=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:session.refresh_token},authenticated:false});
      saveSession({...data,expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in||3600)});return true;
    }catch{saveSession(null);return false}
  }

  async function verifyAndOpen(){
    if(!session?.user){showLogin();return}
    try{
      const rows=await request(`/rest/v1/admin_users?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id`);
      if(!rows?.length)throw new Error();
    }catch{saveSession(null);showLogin();setStatus('#loginStatus','Bu hesap yönetici olarak yetkilendirilmemiş.',true);return}
    currentUser=session.user;loginView.hidden=true;dashboardView.hidden=false;
    await Promise.all([loadProducts(),loadSettings()]);
  }

  function showLogin(){currentUser=null;dashboardView.hidden=true;loginView.hidden=false}

  document.querySelector('#loginForm').addEventListener('submit',async event=>{
    event.preventDefault();setStatus('#loginStatus','Giriş kontrol ediliyor…');
    try{await signIn(document.querySelector('#loginEmail').value.trim(),document.querySelector('#loginPassword').value);setStatus('#loginStatus','');await verifyAndOpen()}
    catch{setStatus('#loginStatus','E-posta veya şifre hatalı.',true)}
  });

  document.querySelector('#logoutButton').addEventListener('click',async()=>{try{await request('/auth/v1/logout',{method:'POST'})}catch{}saveSession(null);showLogin()});
  document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-panel]').forEach(item=>item.classList.toggle('active',item===button));
    document.querySelectorAll('.panel-section').forEach(panel=>panel.hidden=panel.id!==button.dataset.panel);
  }));

  async function loadSettings(){
    try{
      const rows=await request('/rest/v1/site_settings?id=eq.1&select=*');const data=rows?.[0];if(!data)throw new Error();
      const form=document.querySelector('#settingsForm');
      ['phone_display','phone_raw','working_hours_weekdays','working_hours_sunday','service_area_text'].forEach(key=>form.elements[key].value=data[key]||'');
    }catch{setStatus('#settingsStatus','Site bilgileri alınamadı.',true)}
  }

  document.querySelector('#settingsForm').addEventListener('submit',async event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);
    const payload={id:1,phone_display:form.get('phone_display').trim(),phone_raw:form.get('phone_raw').replace(/\D/g,''),working_hours_weekdays:form.get('working_hours_weekdays').trim(),working_hours_sunday:form.get('working_hours_sunday').trim(),service_area_text:form.get('service_area_text').trim(),updated_at:new Date().toISOString()};
    setStatus('#settingsStatus','Kaydediliyor…');
    try{await request('/rest/v1/site_settings?on_conflict=id',{method:'POST',body:payload,headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});setStatus('#settingsStatus','Bilgiler kaydedildi.');toast('Site bilgileri güncellendi')}
    catch(error){setStatus('#settingsStatus',`Kaydedilemedi: ${error.message}`,true)}
  });

  async function loadProducts(){
    try{productCache=await request('/rest/v1/products?select=*&order=sort_order.asc')||[];renderProducts()}
    catch{document.querySelector('#adminProductList').innerHTML='<p>Ürünler yüklenemedi.</p>'}
  }

  function renderProducts(){
    const list=document.querySelector('#adminProductList');if(!productCache.length){list.innerHTML='<p>Henüz ürün eklenmedi.</p>';return}
    list.innerHTML=productCache.map(product=>`<article class="admin-product ${product.active?'':'inactive'}"><div class="product-thumb">${product.image_url?`<img src="${escapeHtml(product.image_url)}" alt="">`:`<span>◇</span>`}</div><div class="product-summary"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${Number(product.price||0).toLocaleString('tr-TR')} ₺ · ${product.active?'Yayında':'Yayında değil'}</span></div><div class="product-row-actions"><button data-edit="${escapeHtml(product.id)}" type="button">Düzenle</button><button class="${product.active?'toggle-off':''}" data-toggle="${escapeHtml(product.id)}" type="button">${product.active?'Yayından kaldır':'Yayınla'}</button></div></article>`).join('');
  }

  document.querySelector('#adminProductList').addEventListener('click',async event=>{
    const edit=event.target.closest('[data-edit]');const toggle=event.target.closest('[data-toggle]');
    if(edit){openProductEditor(productCache.find(item=>item.id===edit.dataset.edit));return}
    if(toggle){
      const product=productCache.find(item=>item.id===toggle.dataset.toggle);if(!product)return;
      try{await request(`/rest/v1/products?id=eq.${encodeURIComponent(product.id)}`,{method:'PATCH',body:{active:!product.active,updated_at:new Date().toISOString()},headers:{Prefer:'return=minimal'}});await loadProducts();toast(product.active?'Ürün yayından kaldırıldı':'Ürün yayınlandı')}
      catch{toast('İşlem tamamlanamadı')}
    }
  });

  function openProductEditor(product=null){
    productForm.reset();productForm.elements.active.checked=true;
    document.querySelector('#productEditorTitle').textContent=product?'Ürünü düzenle':'Yeni ürün';document.querySelector('#imagePreview').hidden=true;
    if(product){
      ['id','name','category','price','condition','location','dimensions','age','icon','sort_order','description','image_url'].forEach(key=>{if(productForm.elements[key])productForm.elements[key].value=product[key]??''});
      productForm.elements.active.checked=Boolean(product.active);
      if(product.image_url){const preview=document.querySelector('#imagePreview');preview.innerHTML=`<img src="${escapeHtml(product.image_url)}" alt="Mevcut ürün fotoğrafı">`;preview.hidden=false}
    }
    setStatus('#productStatus','');productEditor.showModal();
  }

  document.querySelector('#newProductButton').addEventListener('click',()=>openProductEditor());
  document.querySelector('#closeProductEditor').addEventListener('click',()=>productEditor.close());
  document.querySelector('#cancelProductEditor').addEventListener('click',()=>productEditor.close());
  productForm.elements.image_file.addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;const preview=document.querySelector('#imagePreview');preview.innerHTML=`<img src="${URL.createObjectURL(file)}" alt="Seçilen fotoğraf önizlemesi">`;preview.hidden=false});

  productForm.addEventListener('submit',async event=>{
    event.preventDefault();setStatus('#productStatus','Kaydediliyor…');const form=new FormData(productForm);let imageUrl=form.get('image_url')||'';const file=form.get('image_file');
    try{
      if(file?.size){
        if(file.size>6*1024*1024){setStatus('#productStatus','Fotoğraf 6 MB’den küçük olmalıdır.',true);return}
        const extension=(file.name.split('.').pop()||'jpg').toLowerCase();const path=`${currentUser.id}/${crypto.randomUUID()}.${extension}`;
        await request(`/storage/v1/object/product-images/${path}`,{method:'POST',body:file,headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'}});
        imageUrl=`${config.url}/storage/v1/object/public/product-images/${path}`;
      }
      const payload={name:form.get('name').trim(),category:form.get('category'),price:Number(form.get('price')||0),condition:form.get('condition').trim(),location:form.get('location').trim(),dimensions:form.get('dimensions').trim(),age:form.get('age').trim(),icon:form.get('icon'),sort_order:Number(form.get('sort_order')||0),description:form.get('description').trim(),image_url:imageUrl||null,active:form.get('active')==='on',updated_at:new Date().toISOString()};
      const id=form.get('id');await request(id?`/rest/v1/products?id=eq.${encodeURIComponent(id)}`:'/rest/v1/products',{method:id?'PATCH':'POST',body:payload,headers:{Prefer:'return=minimal'}});
      productEditor.close();await loadProducts();toast(id?'Ürün güncellendi':'Yeni ürün eklendi');
    }catch(error){setStatus('#productStatus',`Kaydedilemedi: ${error.message}`,true)}
  });

  (async()=>{
    try{session=JSON.parse(localStorage.getItem('spot_admin_session')||'null')}catch{session=null}
    if(session&&Number(session.expires_at||0)<=Math.floor(Date.now()/1000)+30)await refreshSession();
    await verifyAndOpen();
  })();
})();
