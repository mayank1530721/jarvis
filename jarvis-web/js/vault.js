(function(root){
"use strict";
var J=root.J=root.J||{},KEY="jarvis.blackVault.v1",ROUNDS=310000,master=null,mode=null,notes=[],creating=false;
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
  try{
    root.localStorage.setItem(KEY,serialized);
    var check=root.localStorage.getItem(KEY);
    if(check!==serialized)throw Error("Storage verification failed.");
  }catch(e){
    try{root.localStorage.removeItem(KEY)}catch(ignore){}
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
    writeVault(record);
    master=key;mode="private";notes=[];
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
  master=k;mode=m==="review"?"review":"private";notes=n;
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
J.vault={
  exists:function(){try{return!!readVault()}catch(e){return false}},
  setup:setup,unlock:unlock,save:save,
  lock:function(){master=null;mode=null;notes=[]},
  isUnlocked:function(){return!!master},
  mode:function(){return mode},
  getNotes:function(){return notes.slice()}
};
})(typeof window!=="undefined"?window:globalThis);
