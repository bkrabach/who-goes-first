export const SETTINGS_KEY='who-goes-first:settings:v1';
export function defaultSettings(){return {sound:true,volume:100,motion:'system',playInSilentMode:false};}
export function decodeSettings(raw){
  const data=JSON.parse(raw);
  if(data?.version!==1 || typeof data.settings?.sound!=='boolean' ||
    !Number.isInteger(data.settings.volume) || data.settings.volume<0 || data.settings.volume>100 ||
    !['system','reduced'].includes(data.settings.motion) ||
    (data.settings.playInSilentMode!==undefined&&typeof data.settings.playInSilentMode!=='boolean'))throw new Error('Invalid saved settings');
  return {sound:data.settings.sound,volume:data.settings.volume,motion:data.settings.motion,playInSilentMode:data.settings.playInSilentMode??false};
}
export function encodeSettings(settings){return JSON.stringify({version:1,settings});}