// Designed PDF receipt generator (jsPDF). Exposed as window.generateReceiptPDF.
// Accepts a normalized order object:
//   { orderId, date, items:[{name,qty,price}], subtotal, discount, loyaltyUsed,
//     delivery, total, neighborhood, recipient, phone, location, payMethod,
//     giftMessage, surpriseExtra }
(function () {
  const BLACK = [17, 17, 17];
  const GRAY = [120, 120, 120];
  const LIGHT = [232, 232, 232];

  function generateReceiptPDF(o, opts) {
    opts = opts || {};
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF engine still loading — please try again in a moment.');
      return;
    }
    const { jsPDF } = window.jspdf;
    // A5 portrait — receipt-sized, prints cleanly
    const doc = new jsPDF({ unit: 'mm', format: 'a5' });
    const W = doc.internal.pageSize.getWidth();   // 148
    const M = 14;                                  // margin
    const contentW = W - M * 2;
    let y = 0;

    // ── Header band ──
    doc.setFillColor(...BLACK);
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text('SDGMart', M, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text('Order Receipt', M, 23);
    // right side: tagline
    doc.setFontSize(7.5);
    doc.text("Tamale's smart grocery service", W - M, 23, { align: 'right' });

    y = 40;

    // ── Order # + date row ──
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`Order #${o.orderId}`, M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(o.date || new Date().toLocaleDateString('en-GB'), W - M, y, { align: 'right' });

    y += 8;

    // ── Deliver-to block ──
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.line(M, y, W - M, y);
    y += 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text('DELIVER TO', M, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...BLACK);
    const dt = [];
    if (o.recipient) dt.push(o.recipient);
    if (o.phone) dt.push(o.phone);
    doc.text(dt.join('  ·  ') || '—', M, y);
    y += 5;
    doc.setTextColor(...GRAY);
    doc.setFontSize(8.5);
    const loc = [o.neighborhood, o.location].filter(Boolean).join(' — ');
    const locLines = doc.splitTextToSize(loc || '—', contentW);
    doc.text(locLines, M, y);
    y += locLines.length * 4.5 + 4;

    // ── Items table header ──
    doc.setFillColor(245, 243, 238);
    doc.rect(M, y - 4, contentW, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text('ITEM', M + 2, y);
    doc.text('QTY', W - M - 32, y, { align: 'right' });
    doc.text('AMOUNT', W - M - 2, y, { align: 'right' });
    y += 7;

    // ── Items rows ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);
    (o.items || []).forEach(it => {
      const lineTotal = (Number(it.price) || 0) * (Number(it.qty) || 1);
      const nameLines = doc.splitTextToSize(it.name, contentW - 40);
      doc.text(nameLines, M + 2, y);
      doc.text(String(it.qty || 1), W - M - 32, y, { align: 'right' });
      doc.text(`GHS ${lineTotal.toFixed(2)}`, W - M - 2, y, { align: 'right' });
      y += Math.max(nameLines.length * 4.5, 5) + 1.5;
      // page-break safety
      if (y > 175) { doc.addPage(); y = 20; }
    });

    y += 2;
    doc.setDrawColor(...LIGHT);
    doc.line(M, y, W - M, y);
    y += 6;

    // ── Totals (right-aligned) ──
    const totalRow = (label, val, opts2) => {
      opts2 = opts2 || {};
      doc.setFont('helvetica', opts2.bold ? 'bold' : 'normal');
      doc.setFontSize(opts2.bold ? 12 : 9);
      doc.setTextColor(...(opts2.color || (opts2.bold ? BLACK : GRAY)));
      doc.text(label, W - M - 42, y, { align: 'right' });
      doc.text(val, W - M - 2, y, { align: 'right' });
      y += opts2.bold ? 8 : 5.5;
    };
    totalRow('Subtotal', `GHS ${Number(o.subtotal || 0).toFixed(2)}`);
    if (Number(o.discount) > 0) totalRow('Squad discount', `− GHS ${Number(o.discount).toFixed(2)}`, { color: [26, 26, 26] });
    if (Number(o.loyaltyUsed) > 0) totalRow('Loyalty credit', `− GHS ${Number(o.loyaltyUsed).toFixed(2)}`, { color: [122, 90, 0] });
    totalRow('Delivery', Number(o.delivery) === 0 ? 'FREE' : `GHS ${Number(o.delivery).toFixed(2)}`);
    y += 1;
    doc.setDrawColor(...BLACK);
    doc.setLineWidth(0.4);
    doc.line(W - M - 50, y, W - M, y);
    y += 7;
    totalRow('TOTAL', `GHS ${Number(o.total || 0).toFixed(2)}`, { bold: true });

    y += 2;
    // ── Payment ──
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(`Payment: ${o.payMethod === 'cash' ? 'Cash on Delivery' : 'Mobile Money (MoMo)'}`, M, y);
    y += 7;

    // ── Surprise / gift callout ──
    if (o.surpriseExtra || o.giftMessage) {
      doc.setFillColor(252, 228, 240);
      const note = o.surpriseExtra ? `Gift from SDGMart: ${o.surpriseExtra}` : `Gift message: ${o.giftMessage}`;
      const noteLines = doc.splitTextToSize(note, contentW - 8);
      const boxH = noteLines.length * 4.5 + 8;
      doc.roundedRect(M, y - 2, contentW, boxH, 2, 2, 'F');
      doc.setTextColor(155, 45, 96);
      doc.setFontSize(8.5);
      doc.text(noteLines, M + 4, y + 4);
      y += boxH + 4;
    }

    // ── Footer ──
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.3);
    doc.line(M, pageH - 22, W - M, pageH - 22);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BLACK);
    doc.text('Thank you for shopping with SDGMart!', M, pageH - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text('Questions? WhatsApp us: +233 50 408 2555', M, pageH - 10);

    if (opts.output === 'blob') return doc.output('blob');
    doc.save(`SDGMart-${o.orderId}.pdf`);
  }

  window.generateReceiptPDF = generateReceiptPDF;
})();
