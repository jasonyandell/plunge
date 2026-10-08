// Shared validator. Never log the returned values.
export const loginKeys=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','APPLE_CLIENT_ID','APPLE_TEAM_ID','APPLE_KEY_ID','APPLE_PRIVATE_KEY'];
export function validateLoginConfig(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected a login configuration object.');
  if(Object.keys(value).some(key=>!loginKeys.includes(key)))throw new Error('Unknown login configuration setting.');
  for(const key of Object.keys(value))if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>16000)throw new Error(`Invalid setting: ${key}`);
  for(const group of [loginKeys.slice(0,2),loginKeys.slice(2)])if(group.some(key=>value[key])&&!group.every(key=>value[key]))throw new Error('Provide all settings for each configured provider.');
  if(!Object.keys(value).length)throw new Error('Configure at least one provider.');
  return value;
}
