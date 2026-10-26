'use strict';
// Small direct-Node launchd entry. No shell wrapper, foreground app or AI replay.
const fs=require('node:fs'),path=require('node:path');
process.umask(0o077);
const role=process.argv[2]||'desktop';
if(!['panel','desktop'].includes(role))throw Error('Expected panel or desktop');
const root=path.join(__dirname,'..'),runtime=require('../runtime.cjs');
if(!runtime.checkGuard())throw Error('Storage Guard did not pass');
process.chdir(root);
const logs=path.join(runtime.stateRoot,'service-logs');fs.mkdirSync(logs,{recursive:true,mode:0o700});
const record=value=>fs.appendFileSync(path.join(logs,role+'.log'),new Date().toISOString()+' '+value+'\n',{mode:0o600});
process.on('uncaughtExceptionMonitor',error=>record(error.stack||String(error)));
record('starting pid='+process.pid+' mode='+(runtime.demo?'demo':'local'));
if(role==='desktop')require('../desktop/start.cjs');
else{
 const port=Number(process.env.CANTUS_PANEL_PORT||4589);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
 require('../server.cjs').createServer().listen(port,'127.0.0.1',()=>record('listening '+port));
}
