/**
 * ~15 authentic short adhkar (remembrances), Arabic text with English
 * translation. Sources: the standard maṣādír (Ḥiṣn al-Muslim / fortified
 * Muslim's remembrances, Ṣaḥīḥ al-Bukhārī and Ṣaḥīḥ Muslim) - kept short
 * so each fits one floating notice for 14 seconds.
 */
export interface Dhikr {
  ar: string;
  en: string;
  /** Optionally name where the wording is from, for the notice footer. */
  source?: { ar: string; en: string };
}

export const ADHKAR: Dhikr[] = [
  {
    ar: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    en: "Glory be to Allah and praise be to Him.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
    en: "Glory and praise be to Allah; glory be to Allah the Almighty.",
    source: { ar: "صحيح البخاري", en: "Sahih al-Bukhari" },
  },
  {
    ar: "لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
    en: "There is no god but Allah alone, without partner; to Him belong sovereignty and praise, and He is over all things capable.",
    source: { ar: "صحيح البخاري", en: "Sahih al-Bukhari" },
  },
  {
    ar: "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَىٰ نَبِيِّنَا مُحَمَّدٍ",
    en: "O Allah, send blessings and peace upon our Prophet Muhammad.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ",
    en: "I seek Allah's forgiveness and turn to Him in repentance.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    en: "All praise is due to Allah, Lord of the worlds.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
    en: "There is no power and no strength except with Allah.",
    source: { ar: "صحيح البخاري", en: "Sahih al-Bukhari" },
  },
  {
    ar: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْهُدَىٰ وَالتُّقَىٰ وَالْعَفَافَ وَالْغِنَىٰ",
    en: "O Allah, I ask You for guidance, piety, chastity, and self-sufficiency.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "حَسْبِيَ اللَّهُ وَنِعْمَ الْوَكِيلُ",
    en: "Allah is sufficient for me and the best disposer of affairs.",
    source: { ar: "سورة الأنفال ٨:٤٠ - مأثور", en: "Qur'an 8:40-derived formula" },
  },
  {
    ar: "اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي",
    en: "O Allah, grant my body health, my hearing health, and my sight health.",
    source: { ar: "سنن أبي داود", en: "Sunan Abi Dawud" },
  },
  {
    ar: "سُبْحَانَ اللَّهِ وَالْحَمْدُ لِلَّهِ وَلَا إِلَٰهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ",
    en: "Glory be to Allah, praise be to Allah, there is no god but Allah, and Allah is greatest.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ",
    en: "There is no god but You; glory be to You; I was among the wrongdoers.",
    source: { ar: "سورة الأنبياء ٢١:٨٧", en: "Qur'an 21:87" },
  },
  {
    ar: "رَبِّ زِدْنِي عِلْمًا",
    en: "My Lord, increase me in knowledge.",
    source: { ar: "سورة طه ٢٠:١١٤", en: "Qur'an 20:114" },
  },
  {
    ar: "اللَّهُمَّ أَعِنِّي عَلَىٰ ذِكْرِكَ وَشُكْرِكَ وَحُسْنِ عِبَادَتِكَ",
    en: "O Allah, help me to remember You, thank You, and worship You well.",
    source: { ar: "سنن أبي داود", en: "Sunan Abi Dawud" },
  },
  {
    ar: "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
    en: "I seek refuge in the perfect words of Allah from the evil of what He created.",
    source: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  },
  {
    ar: "وَذَكِّرْهُمْ بِأَيَّامِ اللَّهِ",
    en: "And remind them of the days of Allah.",
    source: { ar: "سورة إبراهيم ١٤:٥", en: "Qur'an 14:5" },
  },
  {
    ar: "قَالَ رَبِّ اشْرَحْ لِي صَدْرِي",
    en: "He said: My Lord, expand for me my breast.",
    source: { ar: "سورة طه ٢٠:٢٥", en: "Qur'an 20:25" },
  },
];
