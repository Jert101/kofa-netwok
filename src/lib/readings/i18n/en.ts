import type { Dictionary } from "./index";

/** English strings for the Daily Readings page. */
export const en: Dictionary = {
  pageTitle: "Daily Readings",
  today: "Today",
  chooseDate: "Choose a date",
  prevDay: "Previous day",
  nextDay: "Next day",
  aboutToday: "About today",
  seasonLabel: "Season",
  weekLabel: "Week",
  colorLabel: "Color",
  rankLabel: "Rank",
  celebrationLabel: "Celebration",
  cycleLabel: "Lectionary cycle",
  weekOf: (n) => `Week ${n}`,
  seasons: {
    Advent: "Advent",
    Christmas: "Christmas",
    "Ordinary Time": "Ordinary Time",
    Lent: "Lent",
    Triduum: "Triduum",
    Easter: "Easter",
  },
  seasonMeanings: {
    Advent: "Four weeks of waiting and preparation for the coming of Christ at Christmas.",
    Christmas: "The celebration of Christ's birth, from Christmas Day through the Baptism of the Lord.",
    "Ordinary Time": "The ordered life of the Church through the year: Christ's teaching, miracles, and the growth of the Kingdom.",
    Lent: "Forty days of prayer, fasting, and almsgiving in preparation for Easter.",
    Triduum: "The three holiest days: the Last Supper, the Passion, and the silence before the Resurrection.",
    Easter: "Fifty days celebrating Christ risen, from Easter Sunday to Pentecost.",
  },
  colors: {
    Green: "Green",
    Violet: "Violet",
    White: "White",
    Red: "Red",
    Rose: "Rose",
  },
  colorMeanings: {
    Green: "Growth in faith through the year.",
    Violet: "Penance and preparation.",
    White: "Joy, glory, and the feasts of the Lord.",
    Red: "The martyrs, and the fire of the Holy Spirit.",
    Rose: "Joy breaking into the waiting, on Gaudete and Laetare Sundays.",
  },
  ranks: {
    Solemnity: "Solemnity",
    Feast: "Feast",
    Memorial: "Memorial",
    "Optional Memorial": "Optional Memorial",
    Weekday: "Weekday",
    Sunday: "Sunday",
  },
  sundayCycle: (c) => `Sundays, Year ${c}`,
  weekdayCycle: (c) => `Weekdays, Year ${c}`,
  weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  ordinal: (n) => {
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1:
        return `${n}st`;
      case 2:
        return `${n}nd`;
      case 3:
        return `${n}rd`;
      default:
        return `${n}th`;
    }
  },
  celebration: (t) => {
    switch (t.kind) {
      case "otSunday":
        return `${en.ordinal(t.n)} Sunday in Ordinary Time`;
      case "seasonSunday": {
        const season = t.season === "Easter" ? "Easter" : t.season;
        return `${en.ordinal(t.n)} Sunday of ${season}`;
      }
      case "ferial": {
        const wd = en.weekdays[t.weekday];
        if (t.season === "Ordinary Time") return `${wd} of week ${t.week ?? "?"} in Ordinary Time`;
        if (t.season === "Lent" && t.week == null) return `${wd} after Ash Wednesday`;
        if (t.season === "Christmas") return t.week === 1 ? `${wd} in the Octave of Christmas` : `${wd} after Epiphany`;
        return `${wd} of the ${en.ordinal(t.week ?? 0)} week of ${t.season}`;
      }
      case "holyWeek":
        return `${en.weekdays[t.weekday]} of Holy Week`;
      case "easterOctave":
        return `${en.weekdays[t.weekday]} in the Octave of Easter`;
      case "christmasWeekday": {
        const wd = en.weekdays[t.weekday];
        if (t.period === "octave") return `${wd} in the Octave of Christmas`;
        if (t.period === "beforeEpiphany") return `${wd} before Epiphany`;
        return `${wd} after Epiphany`;
      }
      case "named":
        return en.named[t.key] ?? t.key;
      case "saint":
        return t.name;
      case "allSouls":
        return "All Souls";
    }
  },
  named: {
    easter: "Easter Sunday",
    ascension: "The Ascension of the Lord",
    pentecost: "Pentecost Sunday",
    trinity: "The Most Holy Trinity",
    corpusChristi: "The Most Holy Body and Blood of Christ",
    christKing: "Our Lord Jesus Christ, King of the Universe",
    christmas: "Christmas",
    maryMotherOfGod: "Mary, the Holy Mother of God",
    epiphany: "The Epiphany of the Lord",
    baptism: "The Baptism of the Lord",
    holyFamily: "The Holy Family",
    palmSunday: "Palm Sunday",
    ashWednesday: "Ash Wednesday",
    holyThursday: "Holy Thursday",
    goodFriday: "Good Friday",
    holySaturday: "Holy Saturday",
  },
  orSaint: (name) => `or ${name}`,
  readingsTitle: "Readings",
  firstReading: "First Reading",
  psalm: "Responsorial Psalm",
  secondReading: "Second Reading",
  acclamation: "Gospel Acclamation",
  gospel: "Gospel",
  secondReadingNote: "The second reading is proclaimed on Sundays and solemnities.",
  usccbButton: "Read the full texts on USCCB",
  usccbNote:
    "Texts open on the US bishops' site. Only the citations live here — no lectionary text is stored.",
  textSize: "Text size",
  sizeSmall: "Small",
  sizeMedium: "Medium",
  sizeLarge: "Large",
  print: "Print",
};
