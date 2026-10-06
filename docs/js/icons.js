/* ============================================
   Icons — shared inline SVG set (Dark Intelligence Terminal)
   14–16px stroke icons, currentColor, loaded before consumers.
   Usage: Icons.zap / Icons.tag('warn', 'ico ico-sm')
   ============================================ */
(function (global) {
    var S = function (body, size) {
        return '<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" ' +
            'width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" ' +
            'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
            'aria-hidden="true" focusable="false">' + body + '</svg>';
    };

    var Icons = {
        /* energy / signal */
        zap: S('<path d="M9 1.5 3.5 9H7.5L6.5 14.5 12.5 6.5H8.5L9 1.5Z"/>'),
        fire: S('<path d="M8 1.5c.6 2.4 1.6 3.4 2.8 4.6A5.2 5.2 0 0 1 12.5 9a4.5 4.5 0 0 1-9 0c0-1.6.7-2.8 1.6-3.9.3 1 .8 1.7 1.6 2.2C6.3 5.2 6.6 3.3 8 1.5Z"/>'),
        burst: S('<path d="M8 2v2.4M8 11.6V14M2 8h2.4M11.6 8H14M3.8 3.8l1.7 1.7M10.5 10.5l1.7 1.7M12.2 3.8l-1.7 1.7M5.5 10.5l-1.7 1.7"/><circle cx="8" cy="8" r="2"/>'),
        chart: S('<path d="M2 13.5V2.5"/><path d="M2 13.5h12"/><path d="M4 10.5 7 7l2.2 2.2L13.5 4"/>'),
        bars: S('<path d="M2.5 13.5h11"/><rect x="3" y="8" width="2.4" height="5"/><rect x="6.8" y="5" width="2.4" height="8"/><rect x="10.6" y="2.5" width="2.4" height="10.5"/>'),
        ruler: S('<path d="M2 10.8 10.8 2l3.2 3.2L5.2 14H2v-3.2Z"/><path d="M6.2 5.8 8 7.6M8.4 3.6l1.8 1.8"/>'),
        spiral: S('<path d="M8 14a6 6 0 1 0-6-6c0 2.2 1.8 4 4 4s3.3-1.6 3.3-3.4c0-1.3-1-2.3-2.2-2.3-1 0-1.7.7-1.7 1.5"/>'),
        thermo: S('<path d="M9.6 8.6V3.2a1.6 1.6 0 1 0-3.2 0v5.4a3 3 0 1 0 3.2 0Z"/><path d="M8 6v5"/>'),
        gauge: S('<path d="M2.5 12a5.5 5.5 0 1 1 11 0"/><path d="M8 12 10.5 7"/>'),

        /* status */
        warn: S('<path d="M8 2 1.8 13h12.4L8 2Z"/><path d="M8 6v3.2"/><path d="M8 11.2h.01"/>'),
        alert: S('<path d="M8 1.8 2.2 12.2h11.6L8 1.8Z"/><path d="M8 6.2v3"/><path d="M8 10.8h.01"/>'),
        storm: S('<path d="M4.5 10.5a3 3 0 0 1 .2-6 4 4 0 0 1 7.6 1.2 2.5 2.5 0 0 1-.3 4.8"/><path d="M8 8.2 6.6 11h2.2L7.4 14.2"/>'),
        shield: S('<path d="M8 1.8 3 3.6v4c0 3 2.1 5.3 5 6.6 2.9-1.3 5-3.6 5-6.6v-4L8 1.8Z"/><path d="M5.9 7.8 7.4 9.3l2.8-2.8"/>'),
        check: S('<path d="M3 8.4 6.4 11.8 13 5.2"/>'),
        close: S('<path d="M4 4l8 8M12 4l-8 8"/>'),
        dot: S('<circle cx="8" cy="8" r="3"/>'),
        plus: S('<path d="M8 3.5v9M3.5 8h9"/>'),
        minus: S('<path d="M3.5 8h9"/>'),
        clock: S('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.6"/>'),
        link: S('<path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-1 1"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l1-1"/>'),
        layers: S('<path d="M8 2 2.2 5 8 8l5.8-3L8 2Z"/><path d="M2.2 8.6 8 11.6l5.8-3"/><path d="M2.2 11.6 8 14.6l5.8-3"/>'),
        star: S('<path d="M8 2.2 9.7 5.8l3.9.5-2.9 2.7.8 3.9L8 11l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5L8 2.2Z"/>'),

        /* seasons */
        snow: S('<path d="M8 1.6v12.8M2.6 4.8l10.8 6.4M13.4 4.8 2.6 11.2"/><path d="M6.4 3 8 4.6 9.6 3M6.4 13 8 11.4 9.6 13"/>'),
        sprout: S('<path d="M8 14V7.2"/><path d="M8 7.2C8 4.4 6 2.6 3.2 2.6c0 2.8 2 4.6 4.8 4.6Z"/><path d="M8 8.4c0-2.4 1.8-4 4.2-4 0 2.4-1.8 4-4.2 4Z"/>'),
        sun: S('<circle cx="8" cy="8" r="3"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>'),
        leaf: S('<path d="M13 3c-6 0-10 3-10 7.2 0 1.6.6 2.8 1.4 3.8C6 11 8.4 8.8 11.6 6.6 9 8.8 7 11.4 6.2 14"/><path d="M13 3c0 5-2.4 8.6-6.8 11"/>'),
        flower: S('<circle cx="8" cy="8" r="1.6"/><path d="M8 2.2a2 2 0 0 1 0 3.6M8 13.8a2 2 0 0 1 0-3.6M2.2 8a2 2 0 0 1 3.6 0M13.8 8a2 2 0 0 1-3.6 0"/>'),
        diamond: S('<path d="M8 2.2 13.8 8 8 13.8 2.2 8 8 2.2Z"/>'),

        /* misc */
        refresh: S('<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13.2 2.2v3.2H10"/>'),
        search: S('<circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/>'),
        filter: S('<path d="M2.2 3.4h11.6L9.4 8.2v4.6l-2.8 1.4V8.2L2.2 3.4Z"/>'),
        bolt: S('<path d="M9 1.5 3.5 9H7.5L6.5 14.5 12.5 6.5H8.5L9 1.5Z"/>'),
        eye: S('<path d="M1.6 8S3.8 3.6 8 3.6 14.4 8 14.4 8 12.2 12.4 8 12.4 1.6 8 1.6 8Z"/><circle cx="8" cy="8" r="1.8"/>'),
        info: S('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4"/><path d="M8 4.8h.01"/>')
    };

    /* alias map: legacy emoji/code names → icon keys */
    Icons.alias = {
        'lightning': 'zap', 'zap2': 'zap', 'flame': 'fire', 'boom': 'burst',
        'trend': 'chart', 'volume': 'bars', 'atr': 'ruler', 'vov': 'spiral',
        'vol': 'thermo', 'ipsi': 'warn', 'weather': 'storm', 'guard': 'shield',
        'yes': 'check', 'no': 'close', 'x': 'close', 'ok': 'check'
    };

    /* tag() — icon + optional label in one span */
    Icons.tag = function (name, cls, label) {
        var key = Icons.alias[name] || name;
        var svg = Icons[key] || Icons.dot;
        return '<span class="ico-wrap' + (cls ? ' ' + cls : '') + '">' + svg +
            (label ? '<span class="ico-label">' + label + '</span>' : '') + '</span>';
    };

    /* icon() — raw svg only, optional pixel size (inline style beats .ico CSS) */
    Icons.icon = function (name, size) {
        var key = Icons.alias[name] || name;
        var svg = Icons[key] || Icons.dot;
        if (!size) return svg;
        return svg.replace('<svg class="ico"',
            '<svg class="ico" style="width:' + size + 'px;height:' + size + 'px"');
    };

    global.Icons = Icons;
})(typeof window !== 'undefined' ? window : this);
