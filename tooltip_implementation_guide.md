# Implementation Plan: Dynamic Statistical Tooltip System

This guide outlines how to implement the context-aware tooltip system used in the Blue Flux dashboard. This system is designed for high-performance financial interfaces where tooltips provide dynamic insights (like percentiles and rankings) rather than just static text.

## 1. Architectural Strategy: Global Delegation
Instead of attaching listeners to every individual element, we use a single global listener on the `document`.

### Why this works:
- **Performance**: Zero memory overhead regardless of the number of tooltips.
- **Dynamic Content**: Automatically works for elements added to the DOM after page load (AJAX/JS-rendered rows).
- **Centralized Logic**: Positioning, boundary detection, and styling are handled in one place.

---

## 2. Component Implementation

### A. The HTML (Global Anchor)
Place this single element at the very end of your `<body>`.
```html
<!-- Global Tooltip Element -->
<div id="global-tooltip"></div>
```

### B. The CSS (Institutional Aesthetic)
Use glassmorphism and smooth transitions for a premium feel.
```css
#global-tooltip {
  position: fixed;
  z-index: 10000;
  background: rgba(16, 17, 20, 0.97); /* Deep dark theme */
  backdrop-filter: blur(8px);           /* Glass effect */
  color: #adbac7;                      /* Muted primary text */
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
  max-width: 280px;
  border: 1px solid rgba(0, 212, 255, 0.25); /* Subtle accent border */
  box-shadow: 0 8px 28px rgba(0,0,0,0.6);   /* Depth */
  pointer-events: none;                /* Never blocks mouse interaction */
  opacity: 0;
  transition: opacity 0.13s ease, transform 0.13s ease;
  transform: translateY(8px);
  font-family: 'Inter', system-ui, sans-serif;
}

#global-tooltip.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Visual cue for the user */
[data-tooltip] {
  cursor: help;
}
```

### C. The JavaScript (Logic & Positioning)
This handles boundary detection (flipping if off-screen) and smooth fade-out.
```javascript
(function() {
  const tt = document.getElementById('global-tooltip');
  let hideTimer = null;

  document.addEventListener('mouseover', function(e) {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    
    tt.textContent = text;
    tt.classList.add('visible');

    // POSITIONING LOGIC
    const rect = target.getBoundingClientRect();
    const GAP = 12;
    
    // Reset position to calculate accurate width/height
    tt.style.top = '-9999px'; 
    tt.style.left = '-9999px';
    
    let left = rect.left + (rect.width / 2) - (tt.offsetWidth / 2);
    let top = rect.top - tt.offsetHeight - GAP;

    // Flip below if not enough space at the top
    if (top < 8) top = rect.bottom + GAP;

    // Boundary checks (prevent overflow)
    if (left < 8) left = 8;
    if (left + tt.offsetWidth > window.innerWidth - 8) {
      left = window.innerWidth - tt.offsetWidth - 8;
    }

    tt.style.top = top + 'px';
    tt.style.left = left + 'px';
  });

  document.addEventListener('mouseout', function(e) {
    if (e.target.closest('[data-tooltip]')) {
      hideTimer = setTimeout(() => {
        tt.classList.remove('visible');
      }, 80); // Slight delay for smoother feel
    }
  });
})();
```

---

## 3. High-Context Data Mapping
The "dynamic nature" is achieved by generating the `data-tooltip` value at render-time using **Template Literals**.

### Example 1: Ranking in a Table
When rendering a historical table, calculate the rank relative to the dataset:
```javascript
const total = allPrices.length;
const rank = sortedPrices.indexOf(currentPrice) + 1;

const html = `
  <tr data-tooltip="Ranked #${rank} out of ${total} historical years for this month.">
    <td>${year}</td>
    <td>${price}</td>
  </tr>
`;
```

### Example 2: Statistical Insight
Explain *why* the number matters using conditional logic:
```javascript
const delta = ((current - average) / average) * 100;
const signal = delta > 10 ? "Significant Deviation" : "Within Normal Range";

const html = `
  <div data-tooltip="${signal}: Currently ${delta.toFixed(1)}% above the 5-year seasonal norm.">
    ${current}
  </div>
`;
```

## 4. Verification & Testing
1.  **Hover Density**: Ensure tooltips trigger reliably when moving rapidly across table rows.
2.  **Boundary Test**: Hover over elements at the very top, bottom, and sides of the viewport.
3.  **Dynamic Update**: Verify that if the table content is re-sorted or updated via JS, the tooltips still work without re-attaching listeners.
