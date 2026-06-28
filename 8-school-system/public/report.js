/* HaloSchool — shared branded term-card renderer.
   printReportCard(d) where d is the payload from GET /api/report/:id
   (school branding + student + results + attendance + grading + position). */
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

  function buildHTML(d) {
    const s = d.school || {}, st = d.student || {}, att = d.attendance || { present: 0, absent: 0, late: 0 };
    const totAtt = att.present + att.absent + att.late;
    const grading = d.grading || [];
    const curTerm = (d.results && d.results[0] && d.results[0].term) || "";

    const hasCA = (d.results || []).some((r) => r.ca_score != null || r.exam_score != null);
    const caw = d.ca_weight ?? 30, examw = d.exam_weight ?? 70;
    const resultRows = (d.results || []).length
      ? d.results.map((r) => {
          const p = r.max_score ? pct(r.score, r.max_score) : 0;
          const caCell = hasCA ? `<td class="c">${r.ca_score != null ? r.ca_score : "—"}</td><td class="c">${r.exam_score != null ? r.exam_score : "—"}</td>` : "";
          return `<tr><td>${esc(r.course)}</td>${caCell}<td class="c">${r.score}</td><td class="c">${p}%</td><td class="c"><b>${esc(r.grade || "")}</b></td><td class="c">${esc(r.subject_position || "")}</td></tr>`;
        }).join("")
      : `<tr><td colspan="${hasCA ? 7 : 5}" class="muted c">No results recorded yet</td></tr>`;
    const resHead = hasCA
      ? `<th>Subject</th><th class="c">Class<br>/${caw}</th><th class="c">Exam<br>/${examw}</th><th class="c">Total</th><th class="c">%</th><th class="c">Grade</th><th class="c">Pos.</th>`
      : `<th>Subject</th><th class="c">Score</th><th class="c">%</th><th class="c">Grade</th><th class="c">Pos.</th>`;

    const gradingKey = grading.map((g) => `<span class="gk"><b>${esc(g.grade)}</b> ${esc(g.remark || "")} (${g.min}+)</span>`).join("");

    const logo = s.logo ? `<img class="logo" src="${s.logo}" alt="">` : "";
    const banner = s.banner ? `<img class="banner" src="${s.banner}" alt="">` : "";
    const contacts = [s.address, s.contact_phone, s.contact_email].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");

    const posBlock = d.position
      ? `<div class="stat"><span>Position</span><b>${d.position_ordinal || d.position} of ${d.classSize}</b></div>`
      : "";
    const avgBlock = d.average != null
      ? `<div class="stat"><span>Average</span><b>${d.average}%</b></div>`
      : "";
    const attRate = totAtt ? pct(att.present, totAtt) : 0;

    const sig = s.head_signature ? `<img class="sig" src="${s.head_signature}" alt="">` : `<div class="sigline"></div>`;

    return `<!doctype html><html><head><meta charset="utf-8"><title>Report Card — ${esc(st.name)}</title>
<style>
  @page{size:A4;margin:14mm}
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1712;margin:0;font-size:13px}
  .sheet{max-width:760px;margin:0 auto;padding:8px}
  ${banner ? ".banner{width:100%;max-height:120px;object-fit:cover;border-radius:8px;margin-bottom:10px}" : ""}
  .head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #171410;padding-bottom:10px}
  .logo{height:74px;width:74px;object-fit:contain}
  .sch h1{margin:0;color:#171410;font-size:24px;letter-spacing:.3px}
  .sch .gold{color:#d99b16}
  .sch .meta{color:#6b6256;font-size:11.5px;margin-top:3px}
  .title{text-align:center;font-weight:700;letter-spacing:3px;color:#d99b16;margin:12px 0 4px;text-transform:uppercase}
  .sub{text-align:center;color:#6b6256;margin-bottom:12px}
  .info{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;background:#faf6ec;border:1px solid #ece0c6;border-radius:10px;padding:10px 14px}
  .info div{font-size:12.5px}.info b{color:#171410}
  .stats{display:flex;gap:10px;margin:12px 0}
  .stat{flex:1;border:1px solid #ece0c6;border-radius:10px;padding:8px 10px;text-align:center;background:#fff}
  .stat span{display:block;color:#6b6256;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  .stat b{font-size:18px;color:#171410}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{background:#171410;color:#fdf6e6;padding:8px;text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.4px}
  td{border:1px solid #ece0c6;padding:7px 8px}
  td.c,th.c{text-align:center}
  .muted{color:#9b9080}
  h3{margin:16px 0 6px;color:#171410;font-size:14px;border-left:4px solid #d99b16;padding-left:8px}
  .gkey{display:flex;flex-wrap:wrap;gap:6px}
  .gk{font-size:11px;border:1px solid #ece0c6;border-radius:999px;padding:3px 9px;background:#faf6ec}
  .remarks{margin-top:14px;border:1px solid #ece0c6;border-radius:10px;padding:12px 14px;background:#fff}
  .remarks .label{color:#6b6256;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
  .signrow{display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;gap:20px}
  .signbox{text-align:center;flex:1}
  .sig{height:46px;object-fit:contain;display:block;margin:0 auto 2px}
  .sigline{height:46px;border-bottom:1px solid #444;margin-bottom:2px}
  .signbox .nm{font-weight:700}.signbox .ro{color:#6b6256;font-size:11px}
  .foot{margin-top:18px;text-align:center;color:#6b6256;font-size:11px;border-top:1px solid #ece0c6;padding-top:8px}
  .motto{font-style:italic;color:#d99b16}
  @media print{.noprint{display:none}}
</style></head>
<body><div class="sheet">
  ${banner}
  <div class="head">
    ${logo}
    <div class="sch">
      <h1>${esc(s.name) || "School"}</h1>
      ${s.motto ? `<div class="motto">${esc(s.motto)}</div>` : ""}
      ${contacts ? `<div class="meta">${contacts}</div>` : ""}
    </div>
  </div>

  <div class="title">Terminal Report Card</div>
  ${curTerm ? `<div class="sub">${esc(curTerm)}</div>` : ""}

  <div class="info">
    <div><b>${esc(st.name)}</b></div>
    <div>Admission&nbsp;No: <b>${esc(st.admission_no || "—")}</b></div>
    <div>Class: <b>${esc(st.class_name || "—")}</b></div>
  </div>

  <div class="stats">
    ${posBlock}
    ${avgBlock}
    <div class="stat"><span>Attendance</span><b>${attRate}%</b></div>
  </div>

  <h3>Academic results</h3>
  <table><thead><tr>${resHead}</tr></thead>
  <tbody>${resultRows}</tbody></table>

  <h3>Attendance</h3>
  <table><thead><tr><th class="c">Present</th><th class="c">Absent</th><th class="c">Late</th><th class="c">Rate</th></tr></thead>
  <tbody><tr><td class="c">${att.present}</td><td class="c">${att.absent}</td><td class="c">${att.late}</td><td class="c"><b>${attRate}%</b></td></tr></tbody></table>

  ${(st.conduct || st.attitude || st.interest) ? `<h3>Conduct &amp; character</h3>
  <div class="gkey">
    ${st.conduct ? `<span class="gk"><b>Conduct:</b> ${esc(st.conduct)}</span>` : ""}
    ${st.attitude ? `<span class="gk"><b>Attitude:</b> ${esc(st.attitude)}</span>` : ""}
    ${st.interest ? `<span class="gk"><b>Interest:</b> ${esc(st.interest)}</span>` : ""}
  </div>` : ""}

  <h3>Grading key</h3>
  <div class="gkey">${gradingKey}</div>

  <div class="remarks">
    ${st.class_remark ? `<div class="label">Class teacher's remarks</div><div style="margin:4px 0 10px">${esc(st.class_remark)}</div>` : ""}
    <div class="label">Head teacher's remarks</div>
    <div style="margin-top:4px">${esc(d.remark || s.report_footer || "Keep up the good work.")}</div>
    ${d.next_term ? `<div style="margin-top:8px"><b>Next term begins:</b> ${esc(d.next_term)}</div>` : ""}
    <div class="signrow">
      <div class="signbox" style="text-align:left">
        <div class="ro">Date</div><div><b>${new Date(d.generated_at || Date.now()).toLocaleDateString()}</b></div>
      </div>
      <div class="signbox">
        ${sig}
        <div class="nm">${esc(s.head_name || "Head Teacher")}</div>
        <div class="ro">Head Teacher</div>
      </div>
    </div>
  </div>

  <div class="foot">
    ${s.report_footer ? esc(s.report_footer) + "<br>" : ""}
    ${esc(s.name)} ${s.code ? "· " + esc(s.code) : ""} · generated by HaloSchool
  </div>
</div></body></html>`;
  }

  // ---- custom template support ----
  function reportVars(d) {
    const s = d.school || {}, st = d.student || {}, att = d.attendance || { present: 0, absent: 0, late: 0 };
    const totAtt = att.present + att.absent + att.late;
    const hasCA = (d.results || []).some((r) => r.ca_score != null || r.exam_score != null);
    const caw = d.ca_weight ?? 30, examw = d.exam_weight ?? 70;
    const resultsRows = (d.results || []).map((r) => {
      const p = r.max_score ? pct(r.score, r.max_score) : 0;
      const caCell = hasCA ? `<td>${r.ca_score != null ? r.ca_score : "—"}</td><td>${r.exam_score != null ? r.exam_score : "—"}</td>` : "";
      return `<tr><td>${esc(r.course)}</td>${caCell}<td>${r.score}</td><td>${p}%</td><td>${esc(r.grade || "")}</td><td>${esc(r.subject_position || "")}</td></tr>`;
    }).join("") || `<tr><td colspan="${hasCA ? 7 : 5}">No results yet</td></tr>`;
    const resHead = hasCA
      ? `<th>Subject</th><th>Class /${caw}</th><th>Exam /${examw}</th><th>Total</th><th>%</th><th>Grade</th><th>Pos.</th>`
      : `<th>Subject</th><th>Score</th><th>%</th><th>Grade</th><th>Pos.</th>`;
    const resultsTable = `<table border="1" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse"><thead><tr>${resHead}</tr></thead><tbody>${resultsRows}</tbody></table>`;
    const gradingKey = (d.grading || []).map((g) => `${esc(g.grade)}: ${esc(g.remark || "")} (${g.min}+)`).join(" &nbsp; ");
    return {
      school_name: esc(s.name), school_code: esc(s.code), school_address: esc(s.address),
      school_phone: esc(s.contact_phone), school_email: esc(s.contact_email), school_motto: esc(s.motto),
      logo_url: s.logo || "", banner_url: s.banner || "", signature_url: s.head_signature || "",
      student_name: esc(st.name), admission_no: esc(st.admission_no), class_name: esc(st.class_name),
      position: d.position_ordinal ? `${d.position_ordinal} of ${d.classSize}` : (d.position ? `${d.position} of ${d.classSize}` : "—"),
      average: d.average != null ? d.average + "%" : "—",
      attendance_rate: (totAtt ? pct(att.present, totAtt) : 0) + "%",
      present: att.present, absent: att.absent, late: att.late,
      conduct: esc(st.conduct), attitude: esc(st.attitude), interest: esc(st.interest), class_remark: esc(st.class_remark),
      next_term: esc(d.next_term),
      term: esc((d.results && d.results[0] && d.results[0].term) || ""),
      results_rows: resultsRows, results_table: resultsTable, grading_key: gradingKey,
      head_name: esc(s.head_name || "Head Teacher"), remark: esc(d.remark || ""),
      footer: esc(s.report_footer || ""), date: new Date(d.generated_at || Date.now()).toLocaleDateString(),
    };
  }
  function stripUnsafe(html) {
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/javascript:/gi, "");
  }
  function fillTemplate(tpl, d) {
    const vars = reportVars(d);
    return stripUnsafe(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => (k in vars ? vars[k] : ""));
  }
  window.DEFAULT_REPORT_TEMPLATE = `<!doctype html><html><head><meta charset="utf-8"><title>Report Card</title>
<style>
  @page{size:A4;margin:14mm}
  body{font-family:Arial,sans-serif;color:#1a1712;max-width:760px;margin:0 auto}
  .head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #171410;padding-bottom:10px}
  .head img{height:74px}
  h1{margin:0;color:#171410}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#171410;color:#fff;padding:7px;text-align:left}
  td{border:1px solid #ddd;padding:6px}
  .sign{margin-top:40px;text-align:right}
</style></head>
<body>
  <div class="head">
    <img src="{{logo_url}}" alt="">
    <div><h1>{{school_name}}</h1><div>{{school_motto}}</div><small>{{school_address}} · {{school_phone}}</small></div>
  </div>
  <h2 style="text-align:center;color:#d99b16">TERMINAL REPORT — {{term}}</h2>
  <p><b>{{student_name}}</b> &nbsp; Adm: {{admission_no}} &nbsp; Class: {{class_name}}<br>
     Position: <b>{{position}}</b> &nbsp; Average: <b>{{average}}</b> &nbsp; Attendance: {{attendance_rate}}</p>
  {{results_table}}
  <p><small>Grading: {{grading_key}}</small></p>
  <p>Remarks: {{remark}}</p>
  <div class="sign"><img src="{{signature_url}}" style="height:44px"><br><b>{{head_name}}</b><br>Head Teacher · {{date}}</div>
  <p style="text-align:center;color:#777"><small>{{footer}}</small></p>
</body></html>`;

  window.printReportCard = function (d) {
    const w = window.open("", "_blank");
    if (!w) { alert("Please allow pop-ups to print the report card."); return; }
    const tpl = d.school && d.school.report_template;
    const html = (tpl && tpl.trim()) ? fillTemplate(tpl, d) : buildHTML(d);
    w.document.open();
    w.document.write(html);
    w.document.close();
    // give embedded logo/signature/banner data-URLs a moment to paint, then print
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 450);
  };
})();
