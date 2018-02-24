/*
 * This file is part of WebSphinx.
 * Copyright (C) 2018 pitchfork@ctrlc.hu
 *
 * WebSphinx is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * WebSphinx is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

"use strict";

const APP_NAME = "websphinx";

var browser = browser || chrome;
var portFromCS;
var nativeport = browser.runtime.connectNative(APP_NAME);
var changeData = true;

var state = {
  user: '',
  site: '',
  login: '',
  change: '',
  create: ''
};

function reset_state() {
  state.user='';
  state.site='';
  state.change='';
  state.create='';
  state.login='';
}

function set_state(site, user, cmd, pwd) {
  if(site != state.site || user!=state.user) reset_state();
  state.site=site;
  state.user=user;
  if(cmd=="create") state.create=pwd;
  if(cmd=="change") state.change=pwd;
  if(cmd=="login") state.login=pwd;
}

nativeport.onMessage.addListener((response) => {
  // internal error handling
  if (browser.runtime.lastError) {
    var error = browser.runtime.lastError.message;
    console.error(error);
    portFromCS.postMessage({ status: "ERROR", error: error });
    return;
  }

  // client error handling
  if(response.results == 'fail') {
    console.log('websphinx failed');
    return;
  }

  // cache password for manual inserts
  if(response.results.cmd=="change" || response.results.cmd=="create" || response.results.cmd=="login") {
    set_state(response.results.site, response.results.name, response.results.cmd, response.results.password);
  }

  // handle manual inserts
  if(response.results.mode == "manual") {
    //console.log("manual");
    // its a manual mode response so we just insert it via inject
    browser.tabs.executeScript({code: 'document.websphinx.inject(' + JSON.stringify(response.results.password) + ');'});
    return;
  }

  // handle get current pwd
  if(response.results.cmd == 'login') {
    // 1st step in an automatic change pwd
    if(changeData==true) {
      // we got the old password
      set_state(response.results.site, response.results.name, response.results.cmd, response.results.password);
      // now change the password
      response.results.cmd="change";
      delete response.results['password']; // don't send the password back
      nativeport.postMessage(response.results);
      return;
    }
    let login = {
      username: response.results.name,
      password: response.results.password
    };
    browser.tabs.executeScript({code: 'document.websphinx.login(' + JSON.stringify(login) + ');'});
    return;
  }

  // handle list users
  if(response.results.cmd == 'list') {
    portFromCS.postMessage(response);
    return;
  }

  // handle create password
  if(response.results.cmd == 'create') {
    let account = {
      username: response.results.name,
      password: response.results.password
    };
    browser.tabs.executeScript({code: 'document.websphinx.create(' + JSON.stringify(account) + ');'});
    return;
  }

  // handle change password
  if(response.results.cmd == 'change') {
    if(state.site!=response.results.site || state.user!=response.results.name) {
      reset_state();
      return; // todo signal error?
    }
    let change = {
      'old': state.login,
      'new': response.results.password
    }
    browser.tabs.executeScript({code: 'document.websphinx.change(' + JSON.stringify(change) + ');'});
    changeData = false;
    return;
  }

  // handle commit result
  if(response.results.cmd == 'commit') {
    portFromCS.postMessage(response);
    return;
  }
  console.log("unhandled native port response");
  console.log(response);
});

browser.runtime.onConnect.addListener(function(p) {
  portFromCS = p;

  // proxy from CS to native backend
  portFromCS.onMessage.addListener(function(request, sender, sendResponse) {
    // clear state if the site has changed
    if(request.site!=state.site) reset_state();
    // same site, if manual insert do so
    else if(request.mode == "manual" &&
            (request.action == 'change' || request.action == 'login' || request.action == 'create') &&
            state[request.action] != '') {
        if(request.name!=state.user) reset_state();
        else {
          browser.tabs.executeScript({code: 'document.websphinx.inject(' + JSON.stringify(state[request.action]) + ');'});
          return;
        }
    }

    // prepare message to native backend
    let msg = {
        cmd: request.action,
        mode: request.mode,
        site: request.site
    };

    if(request.action!="list") msg.name=request.name;
    if (request.action == "login") changeData=false;
    if (request.action == "create") {
      msg.rules= request.rules;
      msg.size= request.size;
    }
    if (request.action == "change") {
      if(request.mode != "manual") {
        // first get old password
        // but this will trigger the login inject in the nativport onmessage cb
        changeData = true;
        msg.cmd= "login";
      }
    }

    if(request.action!="login" &&
       request.action!="list" &&
       request.action!="create" &&
       request.action!="change" &&
       request.action!="commit") {
      console.log("unhandled popup request");
      console.log(request);
      return;
    }

    // send request to native backend
    nativeport.postMessage(msg);
  });
});
