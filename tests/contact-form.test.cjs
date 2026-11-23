'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');

const homepage = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

test('homepage has one visible Netlify contact form with a real honeypot input', () => {
  const $ = load(homepage);
  const forms = $('form[name="contact"]');

  assert.equal(forms.length, 1, 'expected exactly one contact form; remove inert duplicate forms');
  const form = forms.first();

  assert.equal(form.attr('data-netlify'), 'true');
  assert.equal(form.attr('data-netlify-honeypot'), 'bot-field');
  assert.equal(form.attr('hidden'), undefined, 'the contact form must not be hidden');
  assert.equal(form.attr('aria-hidden'), undefined, 'the contact form must be exposed to assistive technology');
  assert.equal((form.attr('method') || '').toUpperCase(), 'POST');

  assert.equal(form.find('input[name="form-name"]').attr('value'), 'contact');
  assert.equal(form.find('input[name="email"]').attr('type'), 'email');

  const honeypot = form.find('input[name="bot-field"]');
  assert.equal(honeypot.length, 1, 'the honeypot attribute needs a matching bot-field input');
  assert.equal(honeypot.attr('tabindex'), '-1');
  assert.ok(honeypot.closest('[hidden]').length > 0, 'the bot-field input must be inside a hidden container');
});
