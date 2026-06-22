// ---------------------------------------------------------------------------
// RFx event → RFP .docx builder.
//
// Renders an RFx event in the SAME format it is defined in the "New RFx event"
// wizard: the event fields (Type, Currency, Title, One-line summary, Brief,
// Closes at, Commercial threshold, and the Surrogate bidding / Alternative
// bids flags) plus the Questions and Scoring dimensions the user
// added. No URS, no AI — what you defined is what gets generated.
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

function fieldRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })] }),
      new TableCell({ width: { size: 68, type: WidthType.PERCENTAGE }, children: [new Paragraph(value || "—")] }),
    ],
  });
}

export async function buildRfxRfpDocx(d: RfxRfpData): Promise<Blob> {
  const yesNo = (b: boolean) => (b ? "Yes" : "No");
  const closes = d.closesAt ? new Date(d.closesAt).toLocaleString() : "—";

  const body: Array<Paragraph | Table> = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: (TYPE_LABEL[d.type] ?? "Request for Proposal").toUpperCase() })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: d.title }),

    // Event definition — same fields as the create wizard, in the same order.
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        fieldRow("Type", TYPE_LABEL[d.type] ?? d.type.toUpperCase()),
        fieldRow("Currency", d.currency),
        fieldRow("Title", d.title),
        fieldRow("One-line summary", d.summary ?? ""),
        fieldRow("Closes at", closes),
        fieldRow("Commercial threshold (%)", String(d.evaluationThresholdPct)),
        fieldRow("Surrogate bidding", yesNo(d.surrogateBiddingAllowed)),
        fieldRow("Alternative bids", yesNo(d.alternativeBidsAllowed)),
      ],
    }),

    new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Brief" }),
    ...(d.brief ? d.brief.split("\n").map((line) => new Paragraph(line)) : [new Paragraph("—")]),
  ];

  // Questions, grouped by section in the same three buckets the form uses.
  if (d.questions.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Questions" }));
    for (const section of ["qualification", "technical", "commercial"]) {
      const qs = d.questions.filter((q) => q.section === section).sort((a, b) => a.order - b.order);
      if (!qs.length) continue;
      body.push(new Paragraph({ heading: HeadingLevel.HEADING_3, text: section.charAt(0).toUpperCase() + section.slice(1) }));
      body.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ children: ["Question", "Type", "Weight", "Required"].map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
            ...qs.map((q) => new TableRow({ children: [q.label, q.kind, String(q.weight), q.required ? "Yes" : "No"].map((c) => new TableCell({ children: [new Paragraph(c)] })) })),
          ],
        }),
      );
    }
  }

  // Scoring dimensions.
  if (d.dimensions.length) {
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Scoring dimensions" }));
    body.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: ["Dimension", "Kind", "Weight"].map((h) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }),
          ...d.dimensions.map((dim) => new TableRow({ children: [dim.label, dim.kind, String(dim.weight)].map((c) => new TableCell({ children: [new Paragraph(c)] })) })),
        ],
      }),
    );
  }

  return Packer.toBlob(new Document({ sections: [{ children: body }] }));
}
