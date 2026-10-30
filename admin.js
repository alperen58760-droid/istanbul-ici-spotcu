(function(){
  const config=window.SPOT_SUPABASE||{};
  const configured=Boolean(config.url&&config.anonKey&&window.supabase);
  const client=configured?window.supabase.createClient(config.url,config.anonKey):null;
  const loginView=document.querySelector('#loginView');
  const dashboardView=document.querySelector('#dashboardView');
  const productEditor=document.querySelector('#productEditor');
  const productForm=document.querySelector('#productForm');
  let currentUser=null;
  let productCache=[];

  const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const setStatus=(id,message,isError=false)=>{const el=document.querySelector(id);el.textContent=message;el.classList.toggle('error',isError)};
  const toast=message=>{const el=document.querySelector('#adminToast');el.textContent=message;el.classList.add('show');clearTimeout(window.adminToastTimer);window.adminToastTimer=setTimeout(()=>el.classList.remove('show'),2200)};

  if(!configured){
    document.querySelector('#setupWarning').hidden=false;
    document.querySelector('#loginForm').querySelectorAll('input,button').forEach(el=>el.disabled=true);
    return;
  }

  async function verifyAndOpen(session){
    if(!session?.user){showLogin();return}
    const {data,error}=await client.from('admin_users').select('user_id').eq('user_id',session.user.id).maybeSingle();
    if(error||!data){await client.auth.signOut();showLogin();setStatus('#loginStatus','Bu hesap yönetici olarak yetkilendirilmemiş.',true);return}
    currentUser=session.user;
    loginView.hidden=true;
    dashboardView.hidden=false;
    await Promise.all([loadProducts(),loadSettings()]);
  }

  function showLogin(){currentUser=null;dashboardView.hidden=true;loginView.hidden=false}

  document.querySelector('#loginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    setStatus('#loginStatus','Giriş kontrol ediliyor…');
    const email=document.querySelector('#loginEmail').value.trim();
    const password=document.querySelector('#loginPassword').value;
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error){setStatus('#loginStatus','E-posta veya şifre hatalı.',true);return}
    setStatus('#loginStatus','');
    await verifyAndOpen(data.session);
  });

  document.querySelector('#logoutButton').addEventListener('click',async()=>{await client.auth.signOut();showLogin()});
  document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('[data-panel]').forEach(item=>item.classList.toggle('active',item===button));
    document.querySelectorAll('.panel-section').forEach(panel=>panel.hidden=panel.id!==button.dataset.panel);
  }));

  async function loadSettings(){
    const {data,error}=await client.from('site_settings').select('*').eq('id',1).maybeSingle();
    if(error||!data){setStatus('#settingsStatus','Site bilgileri alınamadı.',true);return}
    const form=document.querySelector('#settingsForm');
    ['phone_display','phone_raw','working_hours_weekdays','working_hours_sunday','service_area_text'].forEach(key=>form.elements[key].value=data[key]||'');
  }

  document.querySelector('#settingsForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const payload={id:1,phone_display:form.get('phone_display').trim(),phone_raw:form.get('phone_raw').replace(/\D/g,''),working_hours_weekdays:form.get('working_hours_weekdays').trim(),working_hours_sunday:form.get('working_hours_sunday').trim(),service_area_text:form.get('service_area_text').trim(),updated_at:new Date().toISOString()};
    setStatus('#settingsStatus','Kaydediliyor…');
    const {error}=await client.from('site_settings').upsert(payload);
    if(error){setStatus('#settingsStatus',`Kaydedilemedi: ${error.message}`,true);return}
    setStatus('#settingsStatus','Bilgiler kaydedildi.');toast('Site bilgileri güncellendi');
  });

  async function loadProducts(){
    const {data,error}=await client.from('products').select('*').order('sort_order',{ascending:true});
    if(error){document.querySelector('#adminProductList').innerHTML='<p>Ürünler yüklenemedi.</p>';return}
    productCache=data||[];
    renderProducts();
  }

  function renderProducts(){
    const list=document.querySelector('#adminProductList');
    if(!productCache.length){list.innerHTML='<p>Henüz ürün eklenmedi.</p>';return}
    list.innerHTML=productCache.map(product=>`<article class="admin-product ${product.active?'':'inactive'}"><div class="product-thumb">${product.image_url?`<img src="${escapeHtml(product.image_url)}" alt="">`:`<span>◇</span>`}</div><div class="product-summary"><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · ${Number(product.price||0).toLocaleString('tr-TR')} ₺ · ${product.active?'Yayında':'Yayında değil'}</span></div><div class="product-row-actions"><button data-edit="${escapeHtml(product.id)}" type="button">Düzenle</button><button class="${product.active?'toggle-off':''}" data-toggle="${escapeHtml(product.id)}" type="button">${product.active?'Yayından kaldır':'Yayınla'}</button></div></article>`).join('');
  }

  document.querySelector('#adminProductList').addEventListener('click',async event=>{
    const edit=event.target.closest('[data-edit]');
    const toggle=event.target.closest('[data-toggle]');
    if(edit){openProductEditor(productCache.find(item=>item.id===edit.dataset.edit));return}
    if(toggle){
      const product=productCache.find(item=>item.id===toggle.dataset.toggle);if(!product)return;
      const {error}=await client.from('products').update({active:!product.active,updated_at:new Date().toISOString()}).eq('id',product.id);
      if(error){toast('İşlem tamamlanamadı');return}
      await loadProducts();toast(product.active?'Ürün yayından kaldırıldı':'Ürün yayınlandı');
    }
  });

  function openProductEditor(product=null){
    productForm.reset();
    productForm.elements.active.checked=true;
    document.querySelector('#productEditorTitle').textContent=product?'Ürünü düzenle':'Yeni ürün';
    document.querySelector('#imagePreview').hidden=true;
    if(product){
      ['id','name','category','price','condition','location','dimensions','age','icon','sort_order','description','image_url'].forEach(key=>{if(productForm.elements[key])productForm.elements[key].value=product[key]??''});
      productForm.elements.active.checked=Boolean(product.active);
      if(product.image_url){const preview=document.querySelector('#imagePreview');preview.innerHTML=`<img src="${escapeHtml(product.image_url)}" alt="Mevcut ürün fotoğrafı">`;preview.hidden=false}
    }
    setStatus('#productStatus','');
    productEditor.showModal();
  }

  document.querySelector('#newProductButton').addEventListener('click',()=>openProductEditor());
  document.querySelector('#closeProductEditor').addEventListener('click',()=>productEditor.close());
  document.querySelector('#cancelProductEditor').addEventListener('click',()=>productEditor.close());
  productForm.elements.image_file.addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;const preview=document.querySelector('#imagePreview');preview.innerHTML=`<img src="${URL.createObjectURL(file)}" alt="Seçilen fotoğraf önizlemesi">`;preview.hidden=false});

  productForm.addEventListener('submit',async event=>{
    event.preventDefault();
    setStatus('#productStatus','Kaydediliyor…');
    const form=new FormData(productForm);
    let imageUrl=form.get('image_url')||'';
    const file=form.get('image_file');
    if(file?.size){
      if(file.size>6*1024*1024){setStatus('#productStatus','Fotoğraf 6 MB’den küçük olmalıdır.',true);return}
      const extension=(file.name.split('.').pop()||'jpg').toLowerCase();
      const path=`${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const {error:uploadError}=await client.storage.from('product-images').upload(path,file,{cacheControl:'3600',upsert:false});
      if(uploadError){setStatus('#productStatus',`Fotoğraf yüklenemedi: ${uploadError.message}`,true);return}
      imageUrl=client.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    }
    const payload={name:form.get('name').trim(),category:form.get('category'),price:Number(form.get('price')||0),condition:form.get('condition').trim(),location:form.get('location').trim(),dimensions:form.get('dimensions').trim(),age:form.get('age').trim(),icon:form.get('icon'),sort_order:Number(form.get('sort_order')||0),description:form.get('description').trim(),image_url:imageUrl||null,active:form.get('active')==='on',updated_at:new Date().toISOString()};
    const id=form.get('id');
    const result=id?await client.from('products').update(payload).eq('id',id):await client.from('products').insert(payload);
    if(result.error){setStatus('#productStatus',`Kaydedilemedi: ${result.error.message}`,true);return}
    productEditor.close();await loadProducts();toast(id?'Ürün güncellendi':'Yeni ürün eklendi');
  });

  client.auth.getSession().then(({data})=>verifyAndOpen(data.session));
})();
