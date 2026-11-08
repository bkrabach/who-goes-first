export const INSTALL_TIP_KEY='who-goes-first:install-tip-dismissed:v1';
export function runningAsApp(){
  return navigator.standalone===true||['standalone','minimal-ui','window-controls-overlay'].some(mode=>matchMedia(`(display-mode: ${mode})`).matches);
}

export function installGuide({userAgent='',platform='',maxTouchPoints=0}={}){
  if(/iPhone|iPad|iPod/i.test(userAgent)||(/Mac/i.test(platform)&&maxTouchPoints>1)){
    return {title:'Add to your home screen',steps:[
      'Open this page in Safari.',
      'Tap Share, then Add to Home Screen. You may need to scroll down.',
      'Tap Add. Next time, open Who Goes First? from its new icon.'
    ]};
  }
  if(/Android/i.test(userAgent)){
    return {title:'Add to your home screen',steps:[
      'Open the browser menu (the three dots).',
      'Choose Install app or Add to Home screen, then confirm.',
      'Next time, tap the Who Goes First? icon on your home screen.'
    ]};
  }
  if(/Mac/i.test(platform||userAgent)&&/Safari/i.test(userAgent)&&!/Chrome|Chromium|Edg|OPR/i.test(userAgent)){
    return {title:'Keep it in your Dock',steps:[
      'In Safari, open the File menu and choose Add to Dock.',
      'Click Add, then open Who Goes First? from its Dock icon.'
    ]};
  }
  if(/Edg/i.test(userAgent)){
    return {title:'Keep it with your apps',steps:[
      'Open the three-dot menu in Microsoft Edge.',
      'Choose Apps, then Install this site as an app, and confirm.',
      'Next time, open Who Goes First? from your apps or Dock.'
    ]};
  }
  if(/Chrome|Chromium/i.test(userAgent)){
    return {title:'Keep it with your apps',steps:[
      'Look for the install icon beside the address bar.',
      'Click it, then choose Install. You can also look in the browser menu under Cast, save, and share.',
      'Next time, open Who Goes First? from your apps or Dock.'
    ]};
  }
  return {title:'Keep it handy',steps:[
    'Open this page in Safari, Chrome, or Microsoft Edge.',
    'Look for Add to Home Screen, Add to Dock, or Install app in the browser menu.',
    'If that option is not available, bookmark this page. You can keep playing right here.'
  ]};
}

export function initializeInstallGuide(){
  const byId=id=>document.getElementById(id);
  const panel=byId('install-tip'),dialog=byId('install-dialog');
  const preview=document.documentElement.dataset.preview==='true';
  const modes=['standalone','minimal-ui','window-controls-overlay'].map(mode=>matchMedia(`(display-mode: ${mode})`));
  let installed=false,dismissed=false,promptEvent=null,prompting=false;
  const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(/Mac/i.test(navigator.platform)&&navigator.maxTouchPoints>1);
  const isApp=()=>runningAsApp();
  const available=()=>!preview&&window.top===window.self&&window.isSecureContext&&['http:','https:'].includes(location.protocol);
  try{dismissed=localStorage.getItem(INSTALL_TIP_KEY)==='true';}catch{}
  const guide=installGuide(navigator);
  byId('install-tip-title').textContent=guide.title;
  byId('install-guide-title').textContent=guide.title;
  byId('install-steps').replaceChildren(...guide.steps.map(text=>{
    const item=document.createElement('li');item.textContent=text;return item;
  }));
  function render(){
    panel.hidden=!available()||isApp()||installed||dismissed;
    for(const id of ['install-button','install-tip-install']){
      byId(id).hidden=!promptEvent||isApp()||installed||!available();
      byId(id).disabled=prompting;
    }
    byId('install-help').textContent=isApp()?'Installation help':'Add to home screen';
    byId('fit-portrait').hidden=!isApp()||mobile||preview;
    if(isApp())byId('install-context').textContent='You’re already using the app. Your players and preferences stay on this device.';
    else if(preview)byId('install-context').textContent='This is a preview. To add the app, open its published website in your browser.';
    else byId('install-context').textContent='No app-store download or account needed. You can also keep playing in your browser.';
  }
  function rememberDismissal(){
    dismissed=true;
    try{localStorage.setItem(INSTALL_TIP_KEY,'true');}catch{}
    render();
  }
  function openGuide(){dialog.showModal();}
  byId('install-tip-dismiss').addEventListener('click',()=>{
    rememberDismissal();
    if(document.activeElement===byId('install-tip-dismiss'))byId('settings-open').focus();
  });
  byId('install-tip-help').addEventListener('click',openGuide);
  byId('install-help').addEventListener('click',openGuide);
  document.querySelectorAll('.close-install').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    if(preview||isApp())return;
    promptEvent=event;render();
  });
  async function requestInstall(){
    if(!promptEvent||prompting||isApp())return;
    const event=promptEvent;
    prompting=true;render();
    try{
      // Invoke only from this trusted click, never on load or after an await.
      const request=event.prompt();
      await request;
      const choice=await event.userChoice;
      if(choice?.outcome==='accepted'){rememberDismissal();dialog.close();}
    }catch{
      dialog.showModal();
    }finally{
      if(promptEvent===event)promptEvent=null;
      prompting=false;
      render();
    }
  }
  for(const id of ['install-button','install-tip-install'])byId(id).addEventListener('click',requestInstall);
  byId('fit-portrait').addEventListener('click',()=>{
    if(!isApp()||mobile||preview)return;
    const chromeWidth=Math.max(0,outerWidth-innerWidth),chromeHeight=Math.max(0,outerHeight-innerHeight);
    const contentHeight=Math.max(280,Math.min(800,screen.availHeight-chromeHeight-48));
    const contentWidth=Math.max(280,Math.min(560,screen.availWidth-chromeWidth-32,contentHeight*640/920));
    try{
      window.resizeTo(Math.round(contentWidth+chromeWidth),Math.round(contentWidth*920/640+chromeHeight));
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        byId('window-size-status').textContent=Math.abs(innerWidth/innerHeight-640/920)<.1
          ? 'Portrait window fitted. You can still resize it whenever you like.'
          : 'Your browser controls the window size. Drag its edges to make a tall, narrow window. The game stays vertical at any size.';
      }));
    }catch{
      byId('window-size-status').textContent='Your browser controls the window size. Drag its edges to make a tall, narrow window.';
    }
  });
  window.addEventListener('appinstalled',()=>{
    installed=true;promptEvent=null;rememberDismissal();dialog.close();
  });
  window.addEventListener('storage',event=>{
    if(event.key===INSTALL_TIP_KEY){dismissed=event.newValue==='true';render();}
  });
  for(const mode of modes)mode.addEventListener('change',render);
  render();
}