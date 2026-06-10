// Designed PDF receipt generator (jsPDF). Exposed as window.generateReceiptPDF.
// Accepts a normalized order object:
//   { orderId, date, items:[{name,qty,price}], subtotal, discount, loyaltyUsed,
//     delivery, total, neighborhood, recipient, phone, location, payMethod,
//     giftMessage, surpriseExtra }
//
// STYLE: compact thermal-receipt (80mm wide, monospace, like a printed till
// slip). The previous "editorial A5" design lives in git history — revert the
// commit if you prefer it.
(function () {
  function generateReceiptPDF(o, opts) {
    opts = opts || {};
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF engine still loading — please try again in a moment.');
      return;
    }
    const { jsPDF } = window.jspdf;

    const PW = 80;        // paper width (mm) — standard thermal roll
    const M = 5;          // side margin
    const CW = PW - M * 2; // content width
    const items = o.items || [];

    // ── First pass: measure height ──
    // We need to know how many wrapped lines each item name takes. Build a
    // throwaway doc with the same font metrics to measure.
    const probe = new jsPDF({ unit: 'mm', format: [PW, 200] });
    probe.setFont('courier', 'normal');
    probe.setFontSize(8);
    const itemNameWidth = CW - 18; // leave room for the amount column
    let itemLineCount = 0;
    const itemWrapped = items.map(it => {
      const label = `${it.qty || 1}x ${it.name}`;
      const lines = probe.splitTextToSize(label, itemNameWidth);
      itemLineCount += lines.length;
      return lines;
    });

    // Height budget (mm)
    let h = 0;
    h += 6;                       // top pad
    h += 7 + 5 + 4;               // logo + tagline + divider
    h += 5 + 5;                   // order # + date
    h += 4;                       // divider
    h += 4 + 5 + 5 + 5;           // DELIVER TO header + 3 lines
    h += 4;                       // divider
    h += 4;                       // ITEMS header
    h += itemLineCount * 4 + 2;   // item lines
    h += 4;                       // divider
    let totalRows = 2;            // subtotal + delivery
    if (Number(o.discount) > 0) totalRows++;
    if (Number(o.loyaltyUsed) > 0) totalRows++;
    h += totalRows * 4.5;
    h += 3 + 7 + 3;               // double divider + TOTAL + divider
    h += 5;                       // payment line
    if (o.surpriseExtra || o.giftMessage) h += 8;
    h += 6 + 5 + 5 + 6;           // footer divider + thank you + contact + pad

    const doc = new jsPDF({ unit: 'mm', format: [PW, Math.max(h, 90)] });
    const center = PW / 2;
    const right = PW - M;
    let y = 8;

    const dashed = (yy) => {
      doc.setLineDashPattern([0.6, 0.6], 0);
      doc.setDrawColor(120, 120, 120);
      doc.setLineWidth(0.2);
      doc.line(M, yy, PW - M, yy);
      doc.setLineDashPattern([], 0);
    };
    const solid = (yy, w) => {
      doc.setDrawColor(17, 17, 17);
      doc.setLineWidth(w || 0.4);
      doc.line(M, yy, PW - M, yy);
    };

    // ── Header ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(17, 17, 17);
    doc.text('SDGMart', center, y, { align: 'center' });
    y += 5;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    doc.text("Tamale's smart grocery service", center, y, { align: 'center' });
    y += 4;
    solid(y, 0.5); y += 5;

    // ── Order + date ──
    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(17, 17, 17);
    doc.text(`ORDER #${o.orderId}`, M, y);
    y += 5;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(o.date || new Date().toLocaleDateString('en-GB'), M, y);
    y += 4;
    dashed(y); y += 5;

    // ── Deliver to ──
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(17, 17, 17);
    doc.text('DELIVER TO', M, y); y += 5;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.text((o.recipient || '—').slice(0, 34), M, y); y += 4.5;
    if (o.phone) { doc.text(String(o.phone), M, y); y += 4.5; }
    const loc = [o.neighborhood, o.location].filter(Boolean).join(' - ');
    if (loc) { doc.splitTextToSize(loc, CW).forEach(l => { doc.text(l, M, y); y += 4; }); }
    y += 1; dashed(y); y += 5;

    // ── Items ──
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.text('ITEMS', M, y); y += 5;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(17, 17, 17);
    items.forEach((it, i) => {
      const lineTotal = (Number(it.price) || 0) * (Number(it.qty) || 1);
      const lines = itemWrapped[i];
      lines.forEach((ln, li) => {
        doc.text(ln, M, y);
        if (li === 0) doc.text(lineTotal.toFixed(2), right, y, { align: 'right' });
        y += 4;
      });
    });
    y += 1; dashed(y); y += 4.5;

    // ── Totals ──
    const row = (label, val, opts2) => {
      opts2 = opts2 || {};
      doc.setFont('courier', opts2.bold ? 'bold' : 'normal');
      doc.setFontSize(opts2.bold ? 11 : 8);
      doc.setTextColor(...(opts2.gray ? [90, 90, 90] : [17, 17, 17]));
      doc.text(label, M, y);
      doc.text(val, right, y, { align: 'right' });
      y += opts2.bold ? 7 : 4.5;
    };
    row('Subtotal', `GHS ${Number(o.subtotal || 0).toFixed(2)}`, { gray: true });
    if (Number(o.discount) > 0) row('Squad discount', `- ${Number(o.discount).toFixed(2)}`, { gray: true });
    if (Number(o.loyaltyUsed) > 0) row('Loyalty credit', `- ${Number(o.loyaltyUsed).toFixed(2)}`, { gray: true });
    row('Delivery', Number(o.delivery) === 0 ? 'FREE' : `GHS ${Number(o.delivery).toFixed(2)}`, { gray: true });
    y += 1; solid(y, 0.4); y += 6;
    row('TOTAL', `GHS ${Number(o.total || 0).toFixed(2)}`, { bold: true });
    y += 1; solid(y, 0.4); y += 5;

    // ── Payment ──
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text(`Payment: ${o.payMethod === 'cash' ? 'Cash on Delivery' : 'Mobile Money'}`, M, y);
    y += 5;

    // ── Surprise / gift ──
    if (o.surpriseExtra || o.giftMessage) {
      const note = o.surpriseExtra ? `*** ${o.surpriseExtra} ***` : `Gift: ${o.giftMessage}`;
      doc.setTextColor(155, 45, 96);
      doc.setFontSize(7.5);
      doc.splitTextToSize(note, CW).forEach(l => { doc.text(l, center, y, { align: 'center' }); y += 4; });
      y += 1;
    }

    // ── Footer ──
    y += 2; dashed(y); y += 5;
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(17, 17, 17);
    doc.text('Thank you for shopping!', center, y, { align: 'center' });
    y += 5;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(90, 90, 90);
    doc.text('WhatsApp: +233 50 408 2555', center, y, { align: 'center' });

    if (opts.output === 'blob') return doc.output('blob');
    doc.save(`SDGMart-${o.orderId}.pdf`);
  }

  window.generateReceiptPDF = generateReceiptPDF;
})();
