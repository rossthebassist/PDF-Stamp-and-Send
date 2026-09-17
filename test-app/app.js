import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist";

const config = window.PDF_STAMP_CONFIG;
const client = window.zafClient;
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
const errorText = (e) => e?.message || String(e || "Unknown error");
const readDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Unable to read the PDF."));
  reader.readAsDataURL(file);
});

async function loadTicketData() {
  const [ticketResult, userResult, requesterResult, fieldsResult] = await Promise.all([
    client.get("ticket"), client.get("currentUser"), client.get("ticket.requester"), client.get("ticketFields")
  ]);
  const ticket = ticketResult.ticket || {};
  const wanted = new Set(config.customFieldIds.map(String));
  const metadata = {};
  (fieldsResult.ticketFields || []).forEach((field) => {
    if (field?.name?.startsWith("custom_field_")) {
      const id = field.name.replace("custom_field_", "");
      if (wanted.has(id)) metadata[id] = { name: field.name, label: field.label || field.name, options: field.options || [] };
    }
  });
  const customFields = {};
  await Promise.all(config.customFieldIds.map(async (id) => {
    const meta = metadata[String(id)];
    if (!meta) return;
    try {
      const result = await client.get(`ticket.customField:${meta.name}`);
      const value = result[`ticket.customField:${meta.name}`];
      if (value !== null && value !== undefined && value !== "") customFields[String(id)] = { label: meta.label, value };
    } catch (_) {}
  }));
  const attachments = [];
  if (ticket.id) {
    try {
      const result = await client.request({ url: `/api/v2/tickets/${ticket.id}/comments.json`, type: "GET" });
      (result.comments || []).forEach((comment) => (comment.attachments || []).forEach((attachment) => {
        if (attachment.content_type === "application/pdf") attachments.push(attachment);
      }));
    } catch (_) {}
  }
  const costMeta = metadata[String(config.costCentreFieldId)];
  return {
    ticketId: ticket.id,
    requesterName: requesterResult["ticket.requester"]?.name || "",
    agentName: userResult.currentUser?.name || "",
    customFields,
    attachments,
    costCentreFieldName: costMeta?.name || null,
    costCentreOptions: costMeta?.options || []
  };
}

function buildLines(ticket, extra = {}) {
  const fields = ticket?.customFields || {};
  const costId = String(config.costCentreFieldId);
  const driverId = String(config.driverNameFieldId);
  const lines = [`Date: ${new Date().toLocaleDateString("en-GB")}`];
  const requester = extra.requesterOverride?.trim() || ticket?.requesterName;
  if (requester) lines.push(`Requester: ${requester}`);
  if (fields[driverId]?.value) lines.push(`Driver Name: ${fields[driverId].value}`);
  if (ticket?.ticketId) lines.push(`Ticket ID: #${ticket.ticketId}`);
  Object.entries(fields).forEach(([id, field]) => {
    if (!field?.value || id === driverId || (extra.splitEnabled && id === costId)) return;
    lines.push(`${field.label}: ${field.value}`);
  });
  if (ticket?.agentName) lines.push(`Agent: ${ticket.agentName}`);
  if (!extra.splitEnabled) {
    if (extra.notes?.trim()) lines.push(`Notes: ${extra.notes.trim()}`);
    return lines;
  }
  const first = fields[costId]?.value || extra.costCentre || "—";
  lines.push("", `Code 1 — Cost Centre: ${first}`);
  if (extra.code1Amount?.trim()) lines.push(`  Amount: ${extra.code1Amount.trim()}`);
  if (extra.code1Notes?.trim()) lines.push(`  Notes: ${extra.code1Notes.trim()}`);
  lines.push("", `Code 2 — Cost Centre: ${extra.splitCostCentre || "—"}`);
  if (extra.code2Amount?.trim()) lines.push(`  Amount: ${extra.code2Amount.trim()}`);
  if (extra.code2Notes?.trim()) lines.push(`  Notes: ${extra.code2Notes.trim()}`);
  return lines;
}

async function renderPage(dataUrl, pageNumber, scale = 1) {
  const pdf = await pdfjsLib.getDocument(dataUrl).promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width; canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return { canvas, totalPages: pdf.numPages };
}

async function stampPdf(file, position, pageNumber, settings, ticket, extra) {
  const { PDFDocument, rgb, StandardFonts } = await import("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.js");
  const bytes = await file.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPages()[pageNumber - 1];
  if (!page) throw new Error("The selected page is no longer available.");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const size = settings.fontSize;
  const padding = 4;
  const scaleX = page.getWidth() / position.canvasWidth;
  const scaleY = page.getHeight() / position.canvasHeight;
  const x = position.x * scaleX;
  const y = page.getHeight() - position.y * scaleY;
  const width = position.boxWidth * scaleX;
  const wrapped = [];
  buildLines(ticket, extra).forEach((line) => {
    if (!line) { wrapped.push(""); return; }
    let current = "";
    line.split(" ").forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width - padding * 2) current = candidate;
      else { if (current) wrapped.push(current); current = word; }
    });
    if (current) wrapped.push(current);
  });
  const lineHeight = size * 1.4;
  const height = wrapped.length * lineHeight + padding * 2;
  page.drawRectangle({ x, y: y - height, width, height, color: rgb(1, 1, 1), opacity: settings.opacity * .7, borderColor: rgb(.2, .2, .2), borderWidth: .5, borderOpacity: settings.opacity });
  wrapped.forEach((line, index) => page.drawText(line, { x: x + padding, y: y - padding - (index + 1) * lineHeight + (lineHeight - size), size, font, color: rgb(0, 0, 0), opacity: settings.opacity }));
  return new Blob([await pdf.save({ useObjectStreams: false })], { type: "application/pdf" });
}

function App() {
  const [ticket, setTicket] = useState(null), [file, setFile] = useState(null), [dataUrl, setDataUrl] = useState(null);
  const [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(1), [position, setPosition] = useState(null);
  const [settings, setSettings] = useState({ ...config.defaultStampSettings });
  const [requesterOverride, setRequesterOverride] = useState(""), [splitEnabled, setSplitEnabled] = useState(false);
  const [costCentre, setCostCentre] = useState(""), [splitCostCentre, setSplitCostCentre] = useState("");
  const [code1Amount, setCode1Amount] = useState(""), [code1Notes, setCode1Notes] = useState("");
  const [code2Amount, setCode2Amount] = useState(""), [code2Notes, setCode2Notes] = useState("");
  const [notes, setNotes] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null), [drag, setDrag] = useState(null);
  const canvasRef = useRef(null), previewRef = useRef(null);
  const extra = useMemo(() => ({ requesterOverride, splitEnabled, costCentre, splitCostCentre, code1Amount, code1Notes, code2Amount, code2Notes, notes }), [requesterOverride, splitEnabled, costCentre, splitCostCentre, code1Amount, code1Notes, code2Amount, code2Notes, notes]);

  useEffect(() => { loadTicketData().then(setTicket).catch((e) => setMessage({ type: "error", text: `Failed to load ticket data: ${errorText(e)}` })).finally(() => setLoading(false)); }, []);
  useEffect(() => { if (!dataUrl) return; (async () => { try { const width = previewRef.current?.clientWidth || 300; const natural = await renderPage(dataUrl, page); const result = await renderPage(dataUrl, page, width / natural.canvas.width); const canvas = canvasRef.current; if (!canvas) return; canvas.width = result.canvas.width; canvas.height = result.canvas.height; canvas.getContext("2d").drawImage(result.canvas, 0, 0); setTotalPages(result.totalPages); } catch (e) { setMessage({ type: "error", text: `Failed to render PDF: ${errorText(e)}` }); } })(); }, [dataUrl, page]);
  const reset = () => { setFile(null); setDataUrl(null); setPosition(null); setPage(1); setCostCentre(""); setSplitEnabled(false); setSplitCostCentre(""); setCode1Amount(""); setCode1Notes(""); setCode2Amount(""); setCode2Notes(""); setNotes(""); setRequesterOverride(""); setMessage(null); };
  const selectFile = async (nextFile) => { if (!nextFile || nextFile.type !== "application/pdf") return setMessage({ type: "error", text: "Only PDF files are supported." }); try { setFile(nextFile); setDataUrl(await readDataUrl(nextFile)); setPage(1); setPosition(null); setMessage(null); } catch (e) { setMessage({ type: "error", text: errorText(e) }); } };
  const selectAttachment = async (item) => { setBusy(true); try { const response = await fetch(item.content_url); if (!response.ok) throw new Error("Unable to download attachment."); await selectFile(new File([await response.blob()], item.file_name, { type: "application/pdf" })); } catch (e) { setMessage({ type: "error", text: errorText(e) }); } finally { setBusy(false); } };
  const coords = (e) => { const rect = canvasRef.current.getBoundingClientRect(); return { x: (e.clientX - rect.left) * canvasRef.current.width / rect.width, y: (e.clientY - rect.top) * canvasRef.current.height / rect.height }; };
  const pointerDown = (e) => { const start = coords(e); e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ start, current: start }); };
  const pointerMove = (e) => { if (drag) setDrag({ ...drag, current: coords(e) }); };
  const pointerUp = (e) => { if (!drag) return; const end = coords(e); const x = Math.min(drag.start.x, end.x), y = Math.min(drag.start.y, end.y), boxWidth = Math.abs(end.x - drag.start.x), boxHeight = Math.abs(end.y - drag.start.y); setDrag(null); if (boxWidth < 20 || boxHeight < 10) return setMessage({ type: "error", text: "Draw a larger stamp area." }); setPosition({ x, y, boxWidth, boxHeight, canvasWidth: canvasRef.current.width, canvasHeight: canvasRef.current.height }); setMessage(null); };
  const stamp = async () => { if (!file) return setMessage({ type: "error", text: "Select a PDF first." }); if (!position) return setMessage({ type: "error", text: "Draw the stamp area on the PDF preview first." }); if (!ticket) return setMessage({ type: "error", text: "Ticket data is not available yet." }); if (ticket.costCentreOptions.length && !ticket.customFields[String(config.costCentreFieldId)]?.value && !costCentre) return setMessage({ type: "error", text: "Select a Cost Centre before stamping." }); if (splitEnabled && !splitCostCentre) return setMessage({ type: "error", text: "Select a second Cost Centre before stamping." }); setBusy(true); setMessage(null); try { const blob = await stampPdf(file, position, page, settings, ticket, extra); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = file.name.replace(/\.pdf$/i, "") + "_stamped.pdf"; link.click(); URL.revokeObjectURL(url); if (costCentre && ticket.costCentreFieldName) await client.set(`ticket.customField:${ticket.costCentreFieldName}`, costCentre); setMessage({ type: "success", text: "Stamped PDF downloaded." }); } catch (e) { setMessage({ type: "error", text: `Failed to stamp PDF: ${errorText(e)}` }); } finally { setBusy(false); } };
  const rectScale = (value, axis) => value * canvasRef.current.getBoundingClientRect()[axis] / canvasRef.current[axis === "width" ? "width" : "height"];
  const overlay = position && canvasRef.current ? { left: rectScale(position.x, "width"), top: rectScale(position.y, "height"), width: rectScale(position.boxWidth, "width"), minHeight: rectScale(position.boxHeight, "height") } : null;
  const selection = drag && canvasRef.current ? { left: rectScale(Math.min(drag.start.x, drag.current.x), "width"), top: rectScale(Math.min(drag.start.y, drag.current.y), "height"), width: rectScale(Math.abs(drag.current.x - drag.start.x), "width"), height: rectScale(Math.abs(drag.current.y - drag.start.y), "height") } : null;
  if (loading) return <main className="app">Loading ticket data…</main>;
  return <main className="app"><h1>PDF Stamp and Send <small>(test)</small></h1>{message && <div className={`alert ${message.type}`}>{message.text}</div>}
    <div className="field"><label htmlFor="pdf">Upload PDF</label><input id="pdf" type="file" accept="application/pdf" onChange={(e) => selectFile(e.target.files?.[0])} /></div>
    {ticket?.attachments?.length > 0 && <div className="field"><label>Ticket PDF attachments</label><div className="attachments">{ticket.attachments.map((item) => <button className="attachment" disabled={busy} key={item.id} onClick={() => selectAttachment(item)}>📄 {item.file_name}</button>)}</div></div>}
    {dataUrl && <><p className="help">Draw a rectangle on the preview to position the stamp. Changing page clears the placement.</p><div className="preview" ref={previewRef}><canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => setDrag(null)} />{overlay && <div className="overlay" style={{ ...overlay, fontSize: settings.fontSize, opacity: settings.opacity }}>{buildLines(ticket, extra).join("\n")}</div>}{selection && <div className="selection" style={selection} />}</div>
      {totalPages > 1 && <div className="page-nav"><button className="secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); setPosition(null); }}>Previous</button><span>Page {page} of {totalPages}</span><button className="secondary" disabled={page >= totalPages} onClick={() => { setPage(page + 1); setPosition(null); }}>Next</button></div>}
      <hr /><div className="field"><label htmlFor="requester">Requester override (optional)</label><input id="requester" value={requesterOverride} onChange={(e) => setRequesterOverride(e.target.value)} placeholder={ticket.requesterName || "Requester name"} /></div>
      {ticket.costCentreOptions.length > 0 && <><div className="field"><label htmlFor="cost">Cost Centre</label><select id="cost" value={costCentre || ticket.customFields[String(config.costCentreFieldId)]?.value || ""} onChange={(e) => setCostCentre(e.target.value)}><option value="">Select cost centre…</option>{ticket.costCentreOptions.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)}</select></div><div className="field"><label><input type="checkbox" checked={splitEnabled} onChange={(e) => setSplitEnabled(e.target.checked)} /> Split payment between two codes</label></div>{splitEnabled && <div className="split-fields"><div className="field"><label htmlFor="split-cost">Second Cost Centre</label><select id="split-cost" value={splitCostCentre} onChange={(e) => setSplitCostCentre(e.target.value)}><option value="">Select second cost centre…</option>{ticket.costCentreOptions.map((option) => <option key={option.value} value={option.value}>{option.name || option.value}</option>)}</select></div><div className="field"><label>Code 1 amount</label><input value={code1Amount} onChange={(e) => setCode1Amount(e.target.value)} placeholder="e.g. £100" /></div><div className="field"><label>Code 1 notes</label><textarea rows="2" value={code1Notes} onChange={(e) => setCode1Notes(e.target.value)} /></div><div className="field"><label>Code 2 amount</label><input value={code2Amount} onChange={(e) => setCode2Amount(e.target.value)} placeholder="e.g. £200" /></div><div className="field"><label>Code 2 notes</label><textarea rows="2" value={code2Notes} onChange={(e) => setCode2Notes(e.target.value)} /></div></div>}</>}
      <div className="field"><label htmlFor="font">Font size: {settings.fontSize}pt</label><input id="font" type="range" min="6" max="20" value={settings.fontSize} onChange={(e) => setSettings({ ...settings, fontSize: Number(e.target.value) })} /></div><div className="field"><label htmlFor="opacity">Opacity: {Math.round(settings.opacity * 100)}%</label><input id="opacity" type="range" min="10" max="100" step="5" value={Math.round(settings.opacity * 100)} onChange={(e) => setSettings({ ...settings, opacity: Number(e.target.value) / 100 })} /></div><div className="field"><label htmlFor="notes">Additional notes</label><textarea id="notes" rows="3" value={notes} onChange={(e) => setNotes(e.target.value)} /></div><div className="actions"><button disabled={busy || !position} onClick={stamp}>{busy ? "Working…" : "Stamp and download"}</button><button className="secondary" disabled={busy} onClick={() => setPosition(null)}>Reset stamp</button><button className="secondary" disabled={busy} onClick={reset}>Start over</button></div>
    </>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
