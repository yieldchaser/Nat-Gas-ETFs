/* =========================================================================
   BLUE MERIDIAN — ACCESS CONTROL & AUTHENTICATION ENGINE (auth.js)
   Cryptographically secured client-side gateway with zero-exposure pre-auth state
   ========================================================================= */

(function (window) {
    'use strict';

    // Synchronous Pure JS SHA-256 (matches FIPS PUB 180-4 standard)
    function sha256(ascii) {
        function rightRotate(value, amount) {
            return (value >>> amount) | (value << (32 - amount));
        }
        var mathPow = Math.pow;
        var maxWord = mathPow(2, 32);
        var lengthProperty = 'length';
        var i, j;
        var result = '';
        var words = [];
        var asciiBitLength = ascii[lengthProperty] * 8;
        var hash = sha256.h = sha256.h || [];
        var k = sha256.k = sha256.k || [];
        var primeCounter = k[lengthProperty];
        var isComposite = {};
        for (var candidate = 2; primeCounter < 64; candidate++) {
            if (!isComposite[candidate]) {
                for (i = 0; i < 313; i += candidate) {
                    isComposite[i] = candidate;
                }
                hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
                k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
            }
        }
        ascii += '\x80';
        while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
        for (i = 0; i < ascii[lengthProperty]; i++) {
            j = ascii.charCodeAt(i);
            if (j >> 8) return '';
            words[i >> 2] |= j << ((3 - i) % 4) * 8;
        }
        words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
        words[words[lengthProperty]] = (asciiBitLength);
        for (j = 0; j < words[lengthProperty];) {
            var w = words.slice(j, j += 16);
            var oldHash = hash;
            hash = hash.slice(0, 8);
            for (i = 0; i < 64; i++) {
                var w15 = w[i - 15], w2 = w[i - 2];
                var a = hash[0], e = hash[4];
                var temp1 = hash[7]
                    + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
                    + ((e & hash[5]) ^ ((~e) & hash[6]))
                    + k[i]
                    + (w[i] = (i < 16) ? w[i] : (
                            w[i - 16]
                            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
                            + w[i - 7]
                            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
                        ) | 0
                    );
                var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
                    + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
                hash = [(temp1 + temp2) | 0].concat(hash);
                hash[4] = (hash[4] + temp1) | 0;
            }
            for (i = 0; i < 8; i++) {
                hash[i] = (hash[i] + oldHash[i]) | 0;
            }
        }
        for (i = 0; i < 8; i++) {
            for (j = 3; j + 1; j--) {
                var b = (hash[i] >> (j * 8)) & 255;
                result += ((b < 16) ? '0' : '') + b.toString(16);
            }
        }
        return result;
    }

    const CONFIG_SALT = 'BM_SALT_2026_NATGAS';
    const VALID_USER_HASH = '8ac39fdb6c621d5627e6783639cec0add66653560ec5ab5df495dae9c86aa236';
    const VALID_PASS_HASH = '854e961763a5f6b4805ba50174816092bd8df67307109dec8b0400adabca661d';
    const VALID_SESSION_TOKEN = 'afb7e506684308d8a03f01396765b6222b3b417438ad7e5f923302f92bde7b8b';
    const SESSION_KEY = 'bm_session_token';

    const Auth = {
        isAuthenticated: function () {
            try {
                const s = sessionStorage.getItem(SESSION_KEY);
                if (s === VALID_SESSION_TOKEN) return true;
                const l = localStorage.getItem(SESSION_KEY);
                if (l === VALID_SESSION_TOKEN) {
                    sessionStorage.setItem(SESSION_KEY, VALID_SESSION_TOKEN);
                    return true;
                }
            } catch (e) {
                console.warn('Storage check exception:', e);
            }
            return false;
        },

        login: function (username, password, remember) {
            if (!username || !password) return false;
            const uHash = sha256(username.trim().toLowerCase() + ':' + CONFIG_SALT);
            const pHash = sha256(password.trim() + ':' + CONFIG_SALT);

            if (uHash === VALID_USER_HASH && pHash === VALID_PASS_HASH) {
                try {
                    sessionStorage.setItem(SESSION_KEY, VALID_SESSION_TOKEN);
                    if (remember) {
                        localStorage.setItem(SESSION_KEY, VALID_SESSION_TOKEN);
                    } else {
                        localStorage.removeItem(SESSION_KEY);
                    }
                } catch (e) {
                    console.warn('Storage set exception:', e);
                }
                return true;
            }
            return false;
        },

        logout: function () {
            try {
                sessionStorage.removeItem(SESSION_KEY);
                localStorage.removeItem(SESSION_KEY);
            } catch (e) {}
            window.location.replace('index.html');
        },

        requireAuth: function () {
            if (!Auth.isAuthenticated()) {
                document.documentElement.style.display = 'none';
                const cur = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
                window.location.replace('index.html?returnUrl=' + cur);
                return false;
            }
            return true;
        },

        attachLogoutButton: function () {
            const checkAndAttach = () => {
                if (document.getElementById('bm-logout-btn')) return;
                const navRight = document.querySelector('.top-bar-right') || document.querySelector('.page-nav');
                if (navRight) {
                    const btn = document.createElement('button');
                    btn.id = 'bm-logout-btn';
                    btn.className = 'bm-logout-btn';
                    btn.setAttribute('data-tooltip', 'Lock Terminal and End Session');
                    btn.textContent = 'LOGOUT';
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        Auth.logout();
                    });
                    navRight.appendChild(btn);
                }
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkAndAttach);
            } else {
                checkAndAttach();
            }
        },

        renderTerminal: function (onSuccess) {
            document.body.className = 'bm-locked';
            const overlay = document.createElement('div');
            overlay.id = 'bm-auth-overlay';
            overlay.innerHTML = `
                <div class="bm-auth-card">
                    <div class="bm-auth-emblem">
                        <svg viewBox="0 0 100 100">
                            <defs>
                                <radialGradient id="auth-g" cx="50%" cy="60%" r="50%" fx="50%" fy="65%">
                                    <stop offset="0%" style="stop-color:#0033ff;stop-opacity:0.6" />
                                    <stop offset="100%" style="stop-color:#001a4d;stop-opacity:0" />
                                </radialGradient>
                            </defs>
                            <circle cx="50" cy="60" r="40" fill="url(#auth-g)" />
                            <path d="M50 92 C30 92 18 75 18 52 C18 30 50 5 50 5 C50 5 82 30 82 52 C82 75 70 92 50 92 Z" fill="#00e5ff" />
                            <path d="M50 80 C40 80 32 68 32 50 C32 35 50 18 50 18 C50 18 68 35 68 50 C68 68 60 80 50 80 Z" fill="#ffffff" />
                        </svg>
                    </div>
                    <h1 class="bm-auth-title">BLUE MERIDIAN</h1>
                    <div class="bm-auth-pill">
                        <span class="bm-auth-pill-dot"></span>
                        <span>Restricted Terminal Access</span>
                    </div>

                    <form class="bm-auth-form" id="bm-login-form">
                        <div class="bm-auth-field">
                            <label class="bm-auth-label" for="bm-user-input">Operator Identifier</label>
                            <div class="bm-auth-input-wrap">
                                <input type="text" id="bm-user-input" class="bm-auth-input" placeholder="Enter username" autocomplete="username" autofocus required>
                            </div>
                        </div>

                        <div class="bm-auth-field">
                            <label class="bm-auth-label" for="bm-pass-input">Security Access Key</label>
                            <div class="bm-auth-input-wrap">
                                <input type="password" id="bm-pass-input" class="bm-auth-input" placeholder="Enter access password" autocomplete="current-password" required>
                                <button type="button" class="bm-auth-pw-toggle" id="bm-pw-toggle">SHOW</button>
                            </div>
                        </div>

                        <label class="bm-auth-remember">
                            <input type="checkbox" id="bm-remember-chk" checked>
                            <span>Remember session on this device</span>
                        </label>

                        <button type="submit" class="bm-auth-btn" id="bm-submit-btn">AUTHORIZE TERMINAL</button>

                        <div class="bm-auth-error" id="bm-auth-error">
                            Access Denied: Invalid Username or Security Key
                        </div>
                    </form>

                </div>
            `;
            document.body.appendChild(overlay);

            const form = document.getElementById('bm-login-form');
            const uInput = document.getElementById('bm-user-input');
            const pInput = document.getElementById('bm-pass-input');
            const remChk = document.getElementById('bm-remember-chk');
            const errEl = document.getElementById('bm-auth-error');
            const pwToggle = document.getElementById('bm-pw-toggle');

            pwToggle.addEventListener('click', () => {
                if (pInput.type === 'password') {
                    pInput.type = 'text';
                    pwToggle.textContent = 'HIDE';
                } else {
                    pInput.type = 'password';
                    pwToggle.textContent = 'SHOW';
                }
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                errEl.classList.remove('visible');

                const ok = Auth.login(uInput.value, pInput.value, remChk.checked);
                if (ok) {
                    overlay.remove();
                    document.body.className = '';
                    if (typeof onSuccess === 'function') {
                        onSuccess();
                    } else {
                        // Check returnUrl
                        const params = new URLSearchParams(window.location.search);
                        const ret = params.get('returnUrl');
                        if (ret && (ret.endsWith('.html') || !ret.includes('/'))) {
                            window.location.replace(ret);
                        } else {
                            window.location.reload();
                        }
                    }
                } else {
                    errEl.classList.add('visible');
                    pInput.value = '';
                    pInput.focus();
                }
            });
        },

        initIndex: function () {
            if (Auth.isAuthenticated()) {
                Auth.attachLogoutButton();
                Auth.bootDashboard();
            } else {
                Auth.renderTerminal(() => {
                    Auth.attachLogoutButton();
                    Auth.bootDashboard();
                });
            }
        },

        bootDashboard: function () {
            // Reveal template content if wrapped in template
            const tpl = document.getElementById('bm-dashboard-template');
            if (tpl) {
                const clone = document.importNode(tpl.content, true);
                tpl.parentNode.insertBefore(clone, tpl);
                tpl.remove();
            }

            // Dynamically load all dashboard stylesheets if deferred
            const deferredStyles = [
                'css/styles.css?v=20261021a',
                'css/cards.css?v=20261024a',
                'css/signals.css?v=20261101a',
                'css/tail-risk.css?v=20261031a'
            ];
            deferredStyles.forEach(href => {
                if (!document.querySelector(`link[href="${href}"]`)) {
                    const l = document.createElement('link');
                    l.rel = 'stylesheet';
                    l.href = href;
                    document.head.appendChild(l);
                }
            });

            // Dynamically load all scripts in strict sequential order
            const scripts = [
                'js/config.js?v=20261025a',
                'js/data.js?v=20261021a',
                'js/metrics.js?v=20261024a',
                'js/charts.js?v=20261024d',
                'js/cards.js?v=20261018e',
                'js/signals.js?v=20261024d',
                'js/volume-studies.js?v=20261101a',
                'js/volume-profile.js?v=20261030a',
                'js/tail-risk.js?v=20261031a',
                'js/app.js?v=20261021a'
            ];

            function loadNextScript(idx) {
                if (idx >= scripts.length) {
                    Auth.attachLogoutButton();
                    if (typeof App !== 'undefined' && typeof App.init === 'function') {
                        App.init();
                    }
                    return;
                }
                const s = document.createElement('script');
                s.src = scripts[idx];
                s.onload = () => loadNextScript(idx + 1);
                s.onerror = (e) => {
                    console.error('Script load error on', scripts[idx], e);
                    loadNextScript(idx + 1);
                };
                document.body.appendChild(s);
            }
            loadNextScript(0);
        }
    };

    window.Auth = Auth;

})(window);
