'use strict';
// Content Decay Predictor - shared sign-in and API helper for the buy and
// report views.
//
// The key below is the publishable anon key already used by the other tools; it
// only identifies the Supabase project. Every paid read and every purchase is
// authorised again on the server from the bearer token. This file never decides
// whether someone has access.

(() => {
  const ENDPOINT = '/.netlify/functions/content-decay-api';
  const SUPABASE_URL = 'https://ftwohoenimegsmtliqgz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';
  let client = null;

  function getClient() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!client) {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          flowType: 'pkce',
          detectSessionInUrl: false,
          persistSession: true,
          autoRefreshToken: true
        }
      });
    }
    return client;
  }

  async function session() {
    const supabase = getClient();
    if (!supabase) return null;
    try {
      const {data, error} = await supabase.auth.getSession();
      if (error) return null;
      return data?.session || null;
    } catch {
      return null;
    }
  }

  function signInUrl(next) {
    const target = next || (location.pathname + location.search);
    return '/login/?next=' + encodeURIComponent(target);
  }

  async function api(action, {method = 'GET', token, scan, body} = {}) {
    const query = new URLSearchParams();
    if (action) query.set('action', action);
    if (scan) query.set('scan', scan);
    const url = ENDPOINT + (query.toString() ? '?' + query.toString() : '');

    const headers = {Accept: 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify({action, ...body}) : undefined,
        cache: 'no-store'
      });
    } catch {
      throw Object.assign(
        new Error('The connection failed. Check your network and try again.'),
        {status: 0}
      );
    }

    let payload = {};
    try { payload = await response.json(); } catch { /* handled below */ }
    if (!response.ok) {
      throw Object.assign(
        new Error(payload.error || 'The request could not be completed.'),
        {status: response.status, code: payload.code}
      );
    }
    return payload;
  }

  async function download(action, {token, scan} = {}) {
    const query = new URLSearchParams();
    if (action) query.set('action', action);
    if (scan) query.set('scan', scan);
    const url = ENDPOINT + (query.toString() ? '?' + query.toString() : '');

    let response;
    try {
      response = await fetch(url, {
        headers: token ? {Authorization: 'Bearer ' + token} : {},
        cache: 'no-store'
      });
    } catch {
      throw Object.assign(
        new Error('The download failed. Check your connection and try again.'),
        {status: 0}
      );
    }

    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch { /* handled below */ }
      throw Object.assign(
        new Error(payload.error || 'The download could not be completed.'),
        {status: response.status, code: payload.code}
      );
    }

    const disposition = response.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/i.exec(disposition);
    return {
      blob: await response.blob(),
      filename: match ? match[1] : 'content-decay-report.pdf'
    };
  }

  window.ContentDecaySession = {session, signInUrl, api, download};
})();
