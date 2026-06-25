// ---------------------------------------------------------------------------
// RFx event → RFP .docx builder.
//
// Renders the RFx event in the SAME numbered-section format as the canonical
// RFP (RFPTemplate.tsx: Introduction, Scope of Work, Requirements, Proposal
// Requirements, Evaluation Criteria, Submission Deadline, Terms & Conditions).
// The RFx-specific Questions and Scoring dimensions are kept inside the
// sections they belong to (Requirements / Evaluation) so nothing is lost.
// What you defined in the wizard is what populates the sections — no AI.
// ---------------------------------------------------------------------------
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";

export type RfxRfpData = {
  type: string;
  title: string;
  summary: string | null;
  brief: string | null;
  currency: string;
  closesAt: string | null;
  evaluationThresholdPct: number;
  surrogateBiddingAllowed: boolean;
  alternativeBidsAllowed: boolean;
  questions: Array<{ section: string; label: string; kind: string; weight: number; required: boolean; order: number }>;
  dimensions: Array<{ label: string; kind: string; weight: number }>;
};

const TYPE_LABEL: Record<string, string> = { rfi: "Request for Information", rfp: "Request for Proposal", rfq: "Request for Quotation", eauction: "E-Auction" };

// One numbered section: bold heading + body paragraphs (split on newlines).
function section(num: number, title: string, body: string): Array<Paragraph> {
  const heading = new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${num}. ${title}` })] });
  const lines = body ? body.split("\n") : ["—"];
  return [heading, ...lines.map((l) => new Paragraph(l))];
}

function questionsTable(qs: Array<{ label: string; kind: string; weight: number; required: boolean }>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ["Question", "Type", "Weight", "Required"].map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
      ...qs.map((q) => new TableRow({ children: [q.label, q.kind, String(q.weight), q.required ? "Yes" : "No"].map((c) => new TableCell({ children: [new Paragraph(c)] })) })),
    ],
  });
}

export async function buildRfxRfpDocx(d: RfxRfpData): Promise<Blob> {
  const yesNo = (b: boolean) => (b ? "Yes" : "No");
  const closes = d.closesAt ? new Date(d.closesAt).toLocaleString() : "to be communicated separately";
  const docType = TYPE_LABEL[d.type] ?? "Request for Proposal";
  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Requirements questions (qualification + technical) vs commercial questions.
  const reqQs = d.questions.filter((q) => q.section === "qualification" || q.section === "technical").sort((a, b) => a.order - b.order);
  const commQs = d.questions.filter((q) => q.section === "commercial").sort((a, b) => a.order - b.order);

  const body: Array<Paragraph | Table> = [
    // Header band equivalent.
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: docType.toUpperCase() })] }),
    new Paragraph({ children: [new TextRun({ text: `Generated: ${generated}`, italics: true, size: 18 })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: d.title })] }),
    ...(d.summary ? [new Paragraph({ children: [new TextRun({ text: d.summary, italics: true })] })] : []),
    new Paragraph(""),

    // 1. Introduction & Background
    ...section(1, "Introduction & Background",
      `This ${docType} is issued for "${d.title}". Vendors are invited to submit proposals for the provision of goods and services as detailed herein.${d.summary ? `\n\n${d.summary}` : ""}`),
    new Paragraph(""),

    // 2. Scope of Work — the wizard's "Brief" field is the scope.
    ...section(2, "Scope of Work",
      d.brief
        ? d.brief
        : "Vendor must address all functional, technical, quality and regulatory requirements documented in this RFP. The scope covers end-to-end delivery including supply, delivery, quality assurance and ongoing support."),
    new Paragraph(""),
  ];

  // 3. Requirements & Questions — qualification + technical questions vendors must answer.
  body.push(...section(3, "Requirements & Questions",
    reqQs.length
      ? "Vendors must respond to each requirement below. Weights indicate relative importance during evaluation."
      : "As detailed in the Scope of Work above. Vendors must provide a compliance statement against each requirement."));
  if (reqQs.length) { body.push(questionsTable(reqQs)); }
  body.push(new Paragraph(""));

  // 4. Proposal Requirements
  body.push(...section(4, "Proposal Requirements",
    "Proposals must include: (a) Executive Summary, (b) Technical Approach, (c) Implementation/Delivery Timeline with milestones, (d) Itemised Pricing breakdown, (e) Support, Maintenance and Warranty terms, (f) References from at least two comparable engagements."));
  body.push(new Paragraph(""));

  // 5. Evaluation Criteria — scoring dimensions + commercial threshold + commercial questions.
  body.push(...section(5, "Evaluation Criteria",
    `Proposals will be evaluated against the scoring dimensions below. The commercial component is weighted at ${d.evaluationThresholdPct}%. Surrogate bidding: ${yesNo(d.surrogateBiddingAllowed)}. Alternative bids: ${yesNo(d.alternativeBidsAllowed)}.`));
  if (d.dimensions.length) {
    body.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: ["Dimension", "Kind", "Weight"].map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
        ...d.dimensions.map((dim) => new TableRow({ children: [dim.label, dim.kind, String(dim.weight)].map((c) => new TableCell({ children: [new Paragraph(c)] })) })),
      ],
    }));
  }
  if (commQs.length) {
    body.push(new Paragraph({ children: [new TextRun({ text: "Commercial questions", bold: true })] }));
    body.push(questionsTable(commQs));
  }
  body.push(new Paragraph(""));

  // 6. Submission Deadline
  body.push(...section(6, "Submission Deadline",
    `Proposals must be submitted electronically by ${closes}. All amounts are to be quoted in ${d.currency}. Late submissions will not be evaluated.`));
  body.push(new Paragraph(""));

  // 7. Terms & Conditions
  body.push(...section(7, "Terms & Conditions",
    "This RFP does not constitute a commitment to award a contract. The issuing organisation reserves the right to accept or reject any proposal in whole or in part. All proposal materials become property of the issuer upon submission."));

  return Packer.toBlob(new Document({ sections: [{ children: body }] }));
}
