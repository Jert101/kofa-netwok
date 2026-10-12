import type { Dictionary } from "./index";

/**
 * Cebuano (Binisaya) strings for the Daily Readings page.
 *
 * REVIEW STATUS: machine-assisted draft by someone who does not speak
 * Cebuano natively. Every string in this file needs a native speaker's
 * review -- see the README's "needs-native-review" list, which enumerates
 * them. The page falls back to nothing: if a key below is wrong, the page
 * shows the wrong words with full confidence, so review is load-bearing.
 */
export const ceb: Dictionary = {
  pageTitle: "Adlaw-adlaw nga Pagbasa",
  today: "Karon",
  chooseDate: "Pilia ang petsa",
  prevDay: "Miaging adlaw",
  nextDay: "Sunod nga adlaw",
  aboutToday: "Mahitungod karong adlawa",
  seasonLabel: "Panahon",
  weekLabel: "Simana",
  colorLabel: "Kolor",
  rankLabel: "Ranggo",
  celebrationLabel: "Kasaulogan",
  cycleLabel: "Siklo",
  weekOf: (n) => `Simana ${n}`,
  seasons: {
    Advent: "Adbiyento",
    Christmas: "Pasko",
    "Ordinary Time": "Ordinaryong Panahon",
    Lent: "Kwaresma",
    Triduum: "Triduo",
    Easter: "Panahon sa Pagkabanhaw",
  },
  seasonMeanings: {
    Advent: "Upat ka simana sa paghulat ug pagpangandam alang sa pag-abot ni Kristo sa Pasko.",
    Christmas: "Ang pagsaulog sa pagkatawo ni Kristo, gikan sa Pasko hangtod sa Pagbunyag sa Ginoo.",
    "Ordinary Time":
      "Ang han-ay nga kinabuhi sa Simbahan sa tibuok tuig: ang pagtudlo ni Kristo, ang mga milagro, ug ang pagtubo sa Gingharian.",
    Lent: "Kwarenta ka adlaw sa pag-ampo, pagpuasa, ug paglimos isip pangandam alang sa Pasko sa Pagkabanhaw.",
    Triduum:
      "Ang tulo ka labing balaang adlaw: ang Katapusang Panihapon, ang Pagpasakit, ug ang kahilom sa dili pa ang Pagkabanhaw.",
    Easter:
      "Singkwenta ka adlaw sa pagsaulog nga nabanhaw si Kristo, gikan sa Domingo sa Pagkabanhaw hangtod sa Pentekostes.",
  },
  colors: {
    Green: "Berde",
    Violet: "Bayolet",
    White: "Puti",
    Red: "Pula",
    Rose: "Rosas",
  },
  colorMeanings: {
    Green: "Pagtubo sa pagtuo sa tibuok tuig.",
    Violet: "Paghinulsol ug pagpangandam.",
    White: "Kalipay, himaya, ug mga pista sa Ginoo.",
    Red: "Ang mga martir, ug ang kalayo sa Espiritu Santo.",
    Rose: "Kalipay taliwala sa paghulat, sa Gaudete ug Laetare nga mga Domingo.",
  },
  ranks: {
    Solemnity: "Solemnidad",
    Feast: "Pista",
    Memorial: "Handumanan",
    "Optional Memorial": "Opsyonal nga Handumanan",
    Weekday: "Karaniwang Adlaw",
    Sunday: "Domingo",
  },
  sundayCycle: (c) => `Mga Domingo, Tuig ${c}`,
  weekdayCycle: (c) => `Karaniwang mga adlaw, Tuig ${c}`,
  weekdays: ["Domingo", "Lunes", "Martes", "Miyerkules", "Huwebes", "Biyernes", "Sabado"],
  months: [
    "Enero", "Pebrero", "Marso", "Abril", "Mayo", "Hunyo",
    "Hulyo", "Agosto", "Setyembre", "Oktubre", "Nobyembre", "Disyembre",
  ],
  ordinal: (n) => `Ika-${n}`,
  celebration: (t) => {
    switch (t.kind) {
      case "otSunday":
        return `Ika-${t.n} nga Domingo sa Ordinaryong Panahon`;
      case "seasonSunday": {
        const season = ceb.seasons[t.season];
        return `Ika-${t.n} nga Domingo sa ${season}`;
      }
      case "ferial": {
        const wd = ceb.weekdays[t.weekday];
        if (t.season === "Ordinary Time") return `${wd} sa ika-${t.week ?? "?"} nga simana sa Ordinaryong Panahon`;
        if (t.season === "Lent" && t.week == null) return `${wd} tapos sa Miyerkules sa Badlis`;
        if (t.season === "Christmas")
          return t.week === 1 ? `${wd} sa Oktaba sa Pasko` : `${wd} tapos sa Epipaniya`;
        return `${wd} sa ika-${t.week ?? "?"} nga simana sa ${ceb.seasons[t.season]}`;
      }
      case "holyWeek":
        return `${ceb.weekdays[t.weekday]} sa Semana Santa`;
      case "easterOctave":
        return `${ceb.weekdays[t.weekday]} sa Oktaba sa Pagkabanhaw`;
      case "christmasWeekday": {
        const wd = ceb.weekdays[t.weekday];
        if (t.period === "octave") return `${wd} sa Oktaba sa Pasko`;
        if (t.period === "beforeEpiphany") return `${wd} sa dili pa ang Epipaniya`;
        return `${wd} tapos sa Epipaniya`;
      }
      case "named":
        return ceb.named[t.key] ?? t.key;
      case "saint":
        return t.name;
      case "allSouls":
        return "Adlaw sa mga Kalag";
    }
  },
  named: {
    easter: "Domingo sa Pagkabanhaw",
    ascension: "Ang Pagsaka sa Ginoo",
    pentecost: "Domingo sa Pentekostes",
    trinity: "Ang Labing Balaang Trinidad",
    corpusChristi: "Ang Labing Balaang Lawas ug Dugo ni Kristo",
    christKing: "Si Kristo nga Hari",
    christmas: "Pasko",
    maryMotherOfGod: "Si Maria, Inahan sa Dios",
    epiphany: "Ang Epipaniya sa Ginoo",
    baptism: "Ang Pagbunyag sa Ginoo",
    holyFamily: "Ang Balaang Pamilya",
    palmSunday: "Domingo sa Lukay",
    ashWednesday: "Miyerkules sa Badlis",
    holyThursday: "Huwebes Santo",
    goodFriday: "Biyernes Santo",
    holySaturday: "Sabado Santo",
  },
  orSaint: (name) => `o ${name}`,
  readingsTitle: "Mga Pagbasa",
  firstReading: "Unang Pagbasa",
  psalm: "Salmo Responsoryo",
  secondReading: "Ikaduhang Pagbasa",
  acclamation: "Pagdayeg sa Ebanghelyo",
  gospel: "Ebanghelyo",
  secondReadingNote: "Ang ikaduhang pagbasa basahon sa mga Domingo ug solemnidad.",
  usccbButton: "Basaha ang tibuok nga teksto sa USCCB",
  usccbNote:
    "Ang mga teksto maabli sa website sa mga obispo sa US. Mga citation lang ang naa dinhi — walay gitipig nga teksto sa lectionary.",
  textSize: "Gidak-on sa teksto",
  sizeSmall: "Gamay",
  sizeMedium: "Tunga",
  sizeLarge: "Dako",
  print: "I-print",
};
