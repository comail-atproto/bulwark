import { describe, expect, it } from 'vitest';
import { parseVCard, generateVCard } from '../vcard';
import type { ContactCard } from '../jmap/types';

describe('Comail vCard round trips', () => {
  it.each([
    'FN:Dr. John Doe Jr.\r\nN:Doe;John;;;',
    'N:Doe;John;;;\r\nFN:Dr. John Doe Jr.',
  ])('preserves the formatted name when exporting %s', fields => {
    const [card] = parseVCard(`BEGIN:VCARD\r\nVERSION:3.0\r\n${fields}\r\nEND:VCARD`);
    expect(generateVCard([card]).split('\r\n')).toContain('FN:Dr. John Doe Jr.');
  });

  it("keeps escaped semicolons inside structured name and address components", () => {
    const card = parseVCard([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Given; Family",
      "N:Family\\;Branch;Given\\;Middle;;;",
      "ORG:Acme\\; Research;R&D",
      "ADR:;;Unit 2\\; Rear;City\\; District;Region;12345;US",
      "CATEGORIES:personal\\, friends,work",
      "END:VCARD",
    ].join("\r\n"))[0];

    expect(card.name?.components).toContainEqual({ kind: "surname", value: "Family;Branch" });
    expect(card.name?.components).toContainEqual({ kind: "given", value: "Given;Middle" });
    expect(card.organizations?.o0).toMatchObject({ name: "Acme; Research", units: [{ name: "R&D" }] });
    expect(card.addresses?.a0).toMatchObject({ street: "Unit 2; Rear", locality: "City; District" });
    expect(card.keywords).toEqual({ "personal, friends": true, work: true });
  });

  it("preserves literal backslashes before text escapes and separators", () => {
    const original: ContactCard = {
      id: "escaped",
      addressBookIds: {},
      name: { full: "Literal \\n", components: [
        { kind: "given", value: "Given \\n" },
        { kind: "surname", value: "Family;Branch" },
      ] },
      organizations: { o0: { name: "Acme \\n", units: [{ name: "R&D \\" }] } },
      addresses: { a0: { street: "Unit \\n; Rear" } },
      keywords: { "literal \\n, category": true },
    };
    const reparsed = parseVCard(generateVCard([original]))[0];
    expect(reparsed.name?.full).toBe(original.name?.full);
    expect(reparsed.name?.components).toEqual(original.name?.components);
    expect(reparsed.organizations).toEqual(original.organizations);
    expect(reparsed.addresses?.a0.street).toBe(original.addresses?.a0.street);
    expect(reparsed.keywords).toEqual(original.keywords);
  });

  it("preserves multiple labeled values, Unicode, and combined contexts", () => {
    const source = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Zoë 李",
      "EMAIL;TYPE=WORK,HOME:zoe@example.com",
      "EMAIL;TYPE=HOME:家@example.com",
      "TEL;TYPE=WORK,HOME,CELL:+1-555-0100",
      "TEL;TYPE=HOME:+1-555-0101",
      "ADR;TYPE=WORK,HOME:;;Main St;Québec;QC;H2X;CA",
      "ADR;TYPE=HOME:;;Rue Exemple;Montréal;QC;H3A;CA",
      "END:VCARD",
    ].join("\r\n");
    const parsed = parseVCard(source);
    const reparsed = parseVCard(generateVCard(parsed))[0];

    expect(reparsed.emails).toMatchObject({
      e0: { address: "zoe@example.com", contexts: { work: true, private: true } },
      e1: { address: "家@example.com", contexts: { private: true } },
    });
    expect(reparsed.phones).toMatchObject({
      p0: { number: "+1-555-0100", contexts: { work: true, private: true }, features: { mobile: true } },
      p1: { number: "+1-555-0101", contexts: { private: true } },
    });
    expect(reparsed.addresses).toMatchObject({
      a0: { street: "Main St", locality: "Québec", contexts: { work: true, private: true } },
      a1: { street: "Rue Exemple", locality: "Montréal", contexts: { private: true } },
    });
    expect(reparsed.name?.full).toBe("Zoë 李");
  });
});
