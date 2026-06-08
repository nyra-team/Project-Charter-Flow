// ---------------------------------------------------------------------------
// Granules "Annexure — Request for Proposal" .docx builder.
//
// Reproduces the structure of document-templates/Plan/Annexure- Request for
// Proposal.docx programmatically, pre-populated with AI-drafted variable
// content. The boilerplate (confidentiality preamble, Specific Terms,
// Instructions for Proposal Document, commercial cost template) is fixed and
// lives here; only the section bodies marked "AI" come from the model.
//
// Issuing org is always Granules India Limited (the source MSIL template was a
// derived sample — every MSIL reference is replaced with Granules here).
// ---------------------------------------------------------------------------
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

export type RfpAnnexureScopeRow = { requirement: string; description: string };

export type RfpAnnexureData = {
  projectName: string;
  title: string;
  background: string;
  objective: string;
  scopeOfWork: RfpAnnexureScopeRow[];
  deliverables: string;
  successCriteria: string;
  expectedTimelines: string;
  /** Free-text contact line for SCM; optional. */
  contactPerson?: string;
};

const BRAND = "1E40AF"; // Granules primary blue
const INK = "374151";

function heading(num: string, label: string): Paragraph {
  return new Paragraph({
    spacing: { before: 260, after: 120 },
    children: [
      new TextRun({ text: `${num}. `, bold: true, color: BRAND, size: 26 }),
      new TextRun({ text: label, bold: true, color: BRAND, size: 26 }),
    ],
  });
}

/** Split a newline / bullet separated string into paragraphs. */
function bodyParas(text: string, opts: { bullet?: boolean } = {}): Paragraph[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return [new Paragraph({ children: [new TextRun({ text: "—", color: INK })] })];
  return lines.map(
    (line) =>
      new Paragraph({
        spacing: { after: 80 },
        ...(opts.bullet ? { bullet: { level: 0 } } : {}),
        children: [new TextRun({ text: line, color: INK, size: 22 })],
      }),
  );
}

function cell(text: string, opts: { bold?: boolean; header?: boolean; width?: number } = {}): TableCell {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { fill: "EEF2FF" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            bold: opts.bold || opts.header,
            color: opts.header ? BRAND : INK,
            size: 20,
          }),
        ],
      }),
    ],
  });
}

const TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "C7D2FE" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "C7D2FE" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "C7D2FE" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "C7D2FE" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E0E7FF" },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E0E7FF" },
};

function fullTable(rows: TableRow[]): Table {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: TABLE_BORDERS, rows });
}

export async function buildRfpAnnexureDocx(data: RfpAnnexureData): Promise<Blob> {
  const contact = data.contactPerson?.trim() || "Supply Chain Management (SCM) Department, Granules India Limited";

  // ── Key RFP Particulars ──────────────────────────────────────────────
  const particulars = fullTable([
    new TableRow({
      children: [cell("S. No.", { header: true, width: 8 }), cell("Particulars", { header: true, width: 47 }), cell("Details", { header: true, width: 45 })],
      tableHeader: true,
    }),
    new TableRow({ children: [cell("1"), cell("Date of issue of RFP"), cell("To be communicated by SCM")] }),
    new TableRow({ children: [cell("2"), cell("Last date for receipt of proposal"), cell("To be communicated by SCM")] }),
    new TableRow({ children: [cell("3"), cell("Contact Person(s) (for queries and submission of Proposal as RFP Response)"), cell(contact)] }),
  ]);

  // ── 3. Scope of Work table ───────────────────────────────────────────
  const scopeRows: TableRow[] = [
    new TableRow({
      children: [cell("S. No.", { header: true, width: 8 }), cell("Requirement", { header: true, width: 32 }), cell("Description", { header: true, width: 60 })],
      tableHeader: true,
    }),
    ...data.scopeOfWork.map(
      (r, i) => new TableRow({ children: [cell(String(i + 1)), cell(r.requirement), cell(r.description)] }),
    ),
  ];

  // ── 7. Specific Terms (fixed) ────────────────────────────────────────
  const SPECIFIC_TERMS: string[] = [
    "Intellectual Property Rights (IPR): Granules India Limited will have the IPR of all project materials and deliverables.",
    "Compliance: Vendor must adhere to all applicable data privacy and protection regulations.",
    "Use of Data: Vendor must not use the data and information shared by Granules India Limited for any other purposes, other than to deliver the services to Granules India Limited as per scope of work.",
    "Deletion of Data: Vendor must delete all the data, confidential materials etc. shared by Granules India Limited and kept under vendor's custody, upon completion of the project.",
    "Non-Disclosure Agreement: The parties must sign a mutual Non-Disclosure Agreement (if not already signed) to cover the confidentiality of the project materials and deliverables.",
  ];
  const termsRows: TableRow[] = [
    new TableRow({ children: [cell("S. No.", { header: true, width: 8 }), cell("Terms", { header: true, width: 92 })], tableHeader: true }),
    ...SPECIFIC_TERMS.map((t, i) => new TableRow({ children: [cell(String(i + 1)), cell(t)] })),
  ];

  // ── 8. Commercial cost template (fixed) ──────────────────────────────
  const costRows: TableRow[] = [
    new TableRow({
      children: [
        cell("S. No.", { header: true, width: 8 }),
        cell("Roles", { header: true, width: 24 }),
        cell("Cost / Month (INR) [A]", { header: true, width: 17 }),
        cell("No. of Resources [B]", { header: true, width: 13 }),
        cell("No. of Months [C]", { header: true, width: 13 }),
        cell("% Allocation [D]", { header: true, width: 12 }),
        cell("Total Cost (INR) [=A×B×C×D]", { header: true, width: 13 }),
      ],
      tableHeader: true,
    }),
    new TableRow({ children: [cell("e.g."), cell("Project Manager"), cell("…"), cell("1"), cell("3"), cell("25%"), cell("…")] }),
    new TableRow({ children: [cell("e.g."), cell("Data Scientists"), cell("…"), cell("2"), cell("3"), cell("100%"), cell("…")] }),
    new TableRow({ children: [cell(""), cell(""), cell(""), cell(""), cell(""), cell("", { bold: true }), cell("")] }),
    new TableRow({ children: [cell(""), cell("Total", { bold: true }), cell(""), cell(""), cell(""), cell(""), cell("")] }),
  ];

  // ── 8. Submission instructions (fixed) ───────────────────────────────
  const submissionRows: TableRow[] = [
    new TableRow({
      children: [
        cell("S. No.", { header: true, width: 8 }),
        cell("Document name", { header: true, width: 40 }),
        cell("File format", { header: true, width: 14 }),
        cell("Submission mode", { header: true, width: 18 }),
        cell("Password Protection", { header: true, width: 20 }),
      ],
      tableHeader: true,
    }),
    new TableRow({ children: [cell("1"), cell("Technical Proposal_VendorName_DDMMYY"), cell("PDF"), cell("Email"), cell("No")] }),
    new TableRow({ children: [cell("2"), cell("Commercial Proposal_VendorName_DDMMYY"), cell("PDF"), cell("Email"), cell("Yes (Password to be shared separately upon request)")] }),
  ];

  const children: (Paragraph | Table)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Granules India Limited", bold: true, size: 28, color: BRAND })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "Request for Proposal", bold: true, size: 36, color: INK })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: data.title || data.projectName, italics: true, size: 26, color: INK })] }),

    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: "The information contained in this RFP (Request for Proposal) document is confidential in nature. The Parties shall not share this information with any other party not connected with responding to this RFP document. The information contained in this RFP document or subsequently provided to Parties, whether verbally or in writing, by or on behalf of Granules India Limited, shall be subject to the terms and conditions set out in this RFP document and any other terms and conditions subject to which such information is provided.", size: 20, color: INK })],
    }),

    new Paragraph({ spacing: { before: 160, after: 100 }, children: [new TextRun({ text: "Key RFP Particulars:", bold: true, size: 24, color: BRAND })] }),
    particulars,

    heading("1", "Background"),
    ...bodyParas(data.background),
    heading("2", "Objective"),
    ...bodyParas(data.objective),
    heading("3", "Scope of Work"),
    new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "Following is the scope of work for this project.", size: 22, color: INK })] }),
    fullTable(scopeRows),
    heading("4", "Deliverables"),
    ...bodyParas(data.deliverables, { bullet: true }),
    heading("5", "Success Criteria"),
    ...bodyParas(data.successCriteria, { bullet: true }),
    heading("6", "Expected Timelines"),
    ...bodyParas(data.expectedTimelines),

    heading("7", "Specific Terms"),
    new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: "Acceptance required from vendors on the following terms (submission of proposal from vendor indicates the acceptance of these terms, unless otherwise mentioned clearly in the proposal about non-acceptance or need of rephrasing of any specific term(s)).", size: 20, color: INK })] }),
    fullTable(termsRows),

    heading("8", "Instructions for Proposal Document"),
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "The proposal document(s) should cover the following sections:", size: 22, color: INK })] }),
    new Paragraph({ spacing: { before: 80, after: 60 }, children: [new TextRun({ text: "Technical Proposal:", bold: true, size: 22, color: INK })] }),
    ...["Scope of work (as mentioned in this RFP)", "Approach methodology proposed by vendor to execute this project", "Proposed team structure (along with their credentials)", "References (similar exercise done for other clients)"].map(
      (t) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: t, size: 20, color: INK })] }),
    ),
    new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: "Commercial Proposal:", bold: true, size: 22, color: INK })] }),
    new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: "Effort estimation and commercials as per the template given below (to be shared in a separate password-protected document).", size: 20, color: INK })] }),
    fullTable(costRows),
    new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: "Please follow these instructions for proposal document submission.", size: 22, color: INK })] }),
    fullTable(submissionRows),

    new Paragraph({ spacing: { before: 240 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Confidential — Generated by Project Hub (Granules PMO)", italics: true, size: 16, color: "9CA3AF" })] }),
  ];

  const doc = new Document({
    creator: "Granules Project Hub",
    title: `RFP — ${data.projectName}`,
    description: "Auto-generated Request for Proposal (Annexure format)",
    sections: [{ properties: {}, children }],
  });

  return Packer.toBlob(doc);
}
