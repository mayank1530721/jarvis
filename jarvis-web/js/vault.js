(function(root){
"use strict";
var J=root.J=root.J||{},KEY="jarvis.blackVault.v1",ROUNDS=310000,master=null,mode=null,notes=[],chats=[],chatKey=null,creating=false,MAX_CHAT_BYTES=3500000;
function enc(s){return new TextEncoder().encode(String(s))}
function b64(a){var s="";for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]);return btoa(s)}
function un64(s){var x=atob(s),a=new Uint8Array(x.length);for(var i=0;i<x.length;i++)a[i]=x.charCodeAt(i);return a}
function rand(n){var a=new Uint8Array(n);root.crypto.getRandomValues(a);return a}
function report(fn,message){if(typeof fn==="function")fn(message)}
function readVault(){
  try{var raw=root.localStorage.getItem(KEY);return raw?JSON.parse(raw):null}
  catch(e){throw Error("Browser storage is unavailable or blocked. Allow site data for this JARVIS site and try again.")}
}
function writeVault(value){
  var serialized=JSON.stringify(value);
  var previous=null;
  try{previous=root.localStorage.getItem(KEY)}catch(ignore){}
  try{
    root.localStorage.setItem(KEY,serialized);
    var check=root.localStorage.getItem(KEY);
    if(check!==serialized)throw Error("Storage verification failed.");
  }catch(e){
    // A failed save must never destroy what was already stored: put the previous copy back.
    try{if(previous===null)root.localStorage.removeItem(KEY);else root.localStorage.setItem(KEY,previous)}catch(ignore){}
    throw Error("Could not save the encrypted vault in this browser. Check that site storage is enabled and has free space. "+(e&&e.message?e.message:""));
  }
}
async function derive(p,s){
  var m=await root.crypto.subtle.importKey("raw",enc(p),"PBKDF2",false,["deriveKey"]);
  return root.crypto.subtle.deriveKey({name:"PBKDF2",salt:s,iterations:ROUNDS,hash:"SHA-256"},m,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encrypt(k,v){
  var iv=rand(12),d=await root.crypto.subtle.encrypt({name:"AES-GCM",iv:iv},k,enc(JSON.stringify(v)));
  return{iv:b64(iv),data:b64(new Uint8Array(d))};
}
async function decrypt(k,p){
  var d=await root.crypto.subtle.decrypt({name:"AES-GCM",iv:un64(p.iv)},k,un64(p.data));
  return JSON.parse(new TextDecoder().decode(d));
}
async function wrap(p,raw){
  var salt=rand(16),k=await derive(p,salt);
  return{salt:b64(salt),packet:await encrypt(k,{key:b64(new Uint8Array(raw))})};
}
async function unwrap(p,w){
  return un64((await decrypt(await derive(p,un64(w.salt)),w.packet)).key);
}
async function setup(p,r,onProgress){
  if(creating)throw Error("Vault creation is already running.");
  if(!root.crypto||!root.crypto.subtle||!root.isSecureContext)throw Error("Web Crypto is unavailable. Open JARVIS over HTTPS or localhost, not an insecure HTTP or file page.");
  if(typeof p!=="string"||p.length<5||typeof r!=="string"||r.length<5)throw Error("Both passwords must contain at least 5 characters.");
  if(p===r)throw Error("The vault and review passphrases must be different.");
  if(readVault())throw Error("A vault already exists in this browser. Unlock it instead.");
  creating=true;
  try{
    report(onProgress,"Preparing encryption…");
    var raw=rand(32);
    var key=await root.crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
    report(onProgress,"Deriving vault key… this can take a few seconds.");
    var vaultWrap=await wrap(p,raw);
    report(onProgress,"Deriving separate review key…");
    var reviewWrap=await wrap(r,raw);
    report(onProgress,"Encrypting and saving the empty vault…");
    var record={version:1,kdf:"PBKDF2-SHA-256",iterations:ROUNDS,cipher:"AES-256-GCM",vaultWrap:vaultWrap,reviewWrap:reviewWrap,data:await encrypt(key,[])};
    var craw=rand(32);
    record.chatWrap=await wrap(p,craw);
    chatKey=await root.crypto.subtle.importKey("raw",craw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
    writeVault(record);
    master=key;mode="private";notes=[];chats=[];
    return true;
  }finally{creating=false}
}
async function unlock(p,m){
  if(!root.crypto||!root.crypto.subtle)throw Error("Web Crypto is unavailable. Open JARVIS over HTTPS or localhost.");
  var v=readVault();
  if(!v||v.version!==1)throw Error("No Black Vault is set up in this browser.");
  var raw=await unwrap(p,m==="review"?v.reviewWrap:v.vaultWrap);
  var k=await root.crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,m==="review"?["decrypt"]:["encrypt","decrypt"]);
  var n=await decrypt(k,v.data);
  if(!Array.isArray(n))throw Error("Vault data is invalid.");
  var c=[],ck=null;
  if(m!=="review"){
    // Saved chats use their own key, locked only by the owner password: the review-only password cannot open them.
    var craw;
    if(v.chatWrap)craw=await unwrap(p,v.chatWrap);
    else{craw=rand(32);v.chatWrap=await wrap(p,craw)}
    ck=await root.crypto.subtle.importKey("raw",craw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
    if(v.chats){c=await decrypt(ck,v.chats);if(!Array.isArray(c))throw Error("Saved chats are invalid.")}
    if(!readVault().chatWrap)writeVault(v);
  }
  master=k;chatKey=ck;mode=m==="review"?"review":"private";notes=n;chats=c;
  return{mode:mode,notes:notes.slice()};
}
async function save(n){
  if(!master||mode!=="private")throw Error("Unlock with the vault password to edit.");
  if(!Array.isArray(n))throw Error("Entries must be a list.");
  var v=readVault();
  if(!v||v.version!==1)throw Error("The encrypted vault record is missing.");
  v.data=await encrypt(master,n);
  writeVault(v);notes=n.slice();return true;
}

// ---- saved private chats (full transcripts, encrypted with the same key, stored beside the notes) ----
function cleanMessages(list){
  return(list||[]).filter(function(m){return m&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string"&&m.content.trim()})
    .map(function(m){return{role:m.role,content:m.content}});
}
async function writeChats(next){
  if(!master||mode!=="private")throw Error("Unlock with the vault password to edit.");
  var v=readVault();
  if(!v||v.version!==1)throw Error("The encrypted vault record is missing.");
  if(JSON.stringify(next).length>MAX_CHAT_BYTES)throw Error("The vault has no room for more saved chats. Delete some old chats in the Black Vault window first.");
  if(!chatKey)throw Error("The chat key is not available. Unlock again.");
  v.chats=await encrypt(chatKey,next);
  writeVault(v);chats=next;return true;
}
// Adds a chat, or replaces the one with the same id (so a chat can be saved again after every reply).
async function saveChat(chat){
  var msgs=cleanMessages(chat&&chat.messages);
  if(!msgs.some(function(m){return m.role==="user"}))return false;
  var entry={id:String(chat.id),agent:String(chat.agent||""),user:String(chat.user||""),date:String(chat.date||new Date().toISOString()),messages:msgs};
  var next=chats.filter(function(c){return c.id!==entry.id});next.push(entry);
  return writeChats(next);
}
async function deleteChat(id){return writeChats(chats.filter(function(c){return c.id!==String(id)}))}

// ---- private chat summaries ----
function two(n){return n<10?"0"+n:""+n}
function stamp(d){return d.getFullYear()+"-"+two(d.getMonth()+1)+"-"+two(d.getDate())+" "+two(d.getHours())+":"+two(d.getMinutes())}
var SUMMARY_PROMPT="You write short entries for a user's private memory vault. Below is a private conversation between the user and an AI assistant. Write ONE entry about it: what was talked about, anything the user decided, felt, planned or asked to be remembered, and any follow-ups. Use 2 to 6 short sentences of plain text on a single line, in the past tense, calling the person \"the user\". Include only what was actually said; do not guess, advise or add anything. Leave out passwords, card numbers and ID numbers. If the conversation has nothing worth remembering (only greetings or small talk), reply with exactly: NOTHING";
// The conversation as plain text for the summariser. Keeps the newest part if it is long.
function transcript(history,userName,agentName,maxChars){
  maxChars=maxChars||14000;
  var lines=[];
  (history||[]).forEach(function(m){
    if(!m||typeof m.content!=="string"||!m.content.trim())return;
    if(m.role==="user")lines.push((userName||"User")+": "+m.content.trim());
    else if(m.role==="assistant")lines.push((agentName||"Assistant")+": "+m.content.trim());
  });
  var text=lines.join("\n");
  if(text.length<=maxChars)return text;
  var cut=text.slice(text.length-maxChars),nl=cut.indexOf("\n");
  return "[The earlier part of the conversation is left out.]\n"+(nl>=0&&nl<200?cut.slice(nl+1):cut);
}
// The model's answer as one vault line, or "" when it said there was nothing worth keeping.
function cleanSummary(raw){
  var t=String(raw==null?"":raw).replace(/\s*\n+\s*/g," ").replace(/^\s*[-•*]+\s*/,"").replace(/\s{2,}/g," ").trim();
  if(!t||/^nothing(\s+(worth|to)\b.*)?[.!]?$/i.test(t))return"";
  return t.length>900?t.slice(0,897).replace(/\s+\S*$/,"")+"…":t;
}
function summaryEntry(date,agentName,text){return"["+stamp(date)+" · "+agentName+" private chat] "+text}
// What the private chat agent is shown: the newest entries that fit, oldest first, so a growing vault cannot overflow the prompt.
function context(list,maxChars){
  maxChars=maxChars||8000;
  var picked=[],total=0,i;
  for(i=list.length-1;i>=0;i--){
    var l=String(list[i]);
    if(l.length>maxChars)l=l.slice(0,maxChars)+"…";
    if(picked.length&&total+l.length+1>maxChars)break;
    picked.unshift(l);total+=l.length+1;
  }
  var omitted=Math.max(0,i+1);
  return{text:(omitted>0?"[The "+omitted+" oldest vault entries are left out to save space.]\n":"")+picked.join("\n"),omitted:omitted};
}
async function addNote(entry){
  if(!master||mode!=="private")throw Error("Unlock with the vault password to edit.");
  if(typeof entry!=="string"||!entry.trim())throw Error("Nothing to add.");
  await save(notes.concat([entry.trim()]));
  return true;
}
J.vault={
  exists:function(){try{return!!readVault()}catch(e){return false}},
  setup:setup,unlock:unlock,save:save,addNote:addNote,saveChat:saveChat,deleteChat:deleteChat,getChats:function(){return chats.slice()},
  SUMMARY_PROMPT:SUMMARY_PROMPT,transcript:transcript,cleanSummary:cleanSummary,summaryEntry:summaryEntry,context:context,stamp:stamp,
  lock:function(){master=null;chatKey=null;mode=null;notes=[];chats=[]},
  isUnlocked:function(){return!!master},
  mode:function(){return mode},
  getNotes:function(){return notes.slice()}
};
})(typeof window!=="undefined"?window:globalThis);
