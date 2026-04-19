#!/usr/bin/env node
// One-shot script: add `marketing` namespace to every messages/*.json.
// Run once and commit the changes. Safe to re-run — keeps existing keys.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(here, "..", "messages");

const translations = {
  en: {
    nav: {
      features: "Features",
      industries: "Industries",
      pricing: "Pricing",
      about: "About",
      faq: "FAQ",
      signIn: "Sign in",
      startFree: "Start free",
      dashboard: "Dashboard",
    },
    hero: {
      kicker: "New · AI-drafted KRAs live",
      trust: "4.8 on G2 · No credit card · Setup in 30 min · 500+ teams",
    },
    cta: {
      primary: "Start 14-day trial",
      secondary: "Book a walkthrough",
      seeProduct: "See the product",
    },
    pricing: {
      recommended: "Recommended",
      perUser: "Per user",
      perUserSub: "pay only for active seats",
      flat: "Flat monthly",
      flatSub: "fixed price per tier",
      starter: "Starter",
      team: "Team",
      growth: "Growth",
      scale: "Scale",
      enterprise: "Enterprise",
      free: "Free",
      letsTalk: "Let's talk",
    },
    footer: {
      product: "Product",
      company: "Company",
      resources: "Resources",
      legal: "Legal",
      copyright: "© WorkwrK. Built in Bengaluru.",
    },
  },
  es: {
    nav: { features: "Funciones", industries: "Industrias", pricing: "Precios", about: "Nosotros", faq: "FAQ", signIn: "Iniciar sesión", startFree: "Empezar gratis", dashboard: "Panel" },
    hero: { kicker: "Nuevo · KRAs generados por IA", trust: "4.8 en G2 · Sin tarjeta · Listo en 30 min · 500+ equipos" },
    cta: { primary: "Prueba de 14 días", secondary: "Reservar demo", seeProduct: "Ver el producto" },
    pricing: { recommended: "Recomendado", perUser: "Por usuario", perUserSub: "paga solo por cuentas activas", flat: "Mensual fijo", flatSub: "precio fijo por nivel", starter: "Inicial", team: "Equipo", growth: "Crecimiento", scale: "Escala", enterprise: "Empresa", free: "Gratis", letsTalk: "Hablemos" },
    footer: { product: "Producto", company: "Empresa", resources: "Recursos", legal: "Legal", copyright: "© WorkwrK. Hecho en Bengaluru." },
  },
  fr: {
    nav: { features: "Fonctionnalités", industries: "Secteurs", pricing: "Tarifs", about: "À propos", faq: "FAQ", signIn: "Se connecter", startFree: "Essai gratuit", dashboard: "Tableau de bord" },
    hero: { kicker: "Nouveau · KRAs rédigés par IA", trust: "4.8 sur G2 · Sans CB · 30 min pour commencer · 500+ équipes" },
    cta: { primary: "Essai 14 jours", secondary: "Réserver une démo", seeProduct: "Voir le produit" },
    pricing: { recommended: "Recommandé", perUser: "Par utilisateur", perUserSub: "payez seulement les actifs", flat: "Mensuel fixe", flatSub: "prix fixe par palier", starter: "Starter", team: "Équipe", growth: "Croissance", scale: "Échelle", enterprise: "Entreprise", free: "Gratuit", letsTalk: "Parlons-en" },
    footer: { product: "Produit", company: "Entreprise", resources: "Ressources", legal: "Mentions légales", copyright: "© WorkwrK. Conçu à Bengaluru." },
  },
  de: {
    nav: { features: "Funktionen", industries: "Branchen", pricing: "Preise", about: "Über uns", faq: "FAQ", signIn: "Anmelden", startFree: "Kostenlos starten", dashboard: "Dashboard" },
    hero: { kicker: "Neu · KI-entworfene KRAs", trust: "4.8 auf G2 · Keine Kreditkarte · 30 min zum Start · 500+ Teams" },
    cta: { primary: "14-Tage-Testversion", secondary: "Demo buchen", seeProduct: "Produkt ansehen" },
    pricing: { recommended: "Empfohlen", perUser: "Pro Nutzer", perUserSub: "nur aktive Konten zahlen", flat: "Monatlich pauschal", flatSub: "Festpreis pro Stufe", starter: "Starter", team: "Team", growth: "Wachstum", scale: "Skalierung", enterprise: "Enterprise", free: "Kostenlos", letsTalk: "Sprechen Sie uns an" },
    footer: { product: "Produkt", company: "Unternehmen", resources: "Ressourcen", legal: "Rechtliches", copyright: "© WorkwrK. Aus Bengaluru." },
  },
  hi: {
    nav: { features: "विशेषताएँ", industries: "उद्योग", pricing: "मूल्य", about: "हमारे बारे में", faq: "सामान्य प्रश्न", signIn: "साइन इन", startFree: "मुफ्त शुरू करें", dashboard: "डैशबोर्ड" },
    hero: { kicker: "नया · AI द्वारा तैयार KRA", trust: "G2 पर 4.8 · कोई क्रेडिट कार्ड नहीं · 30 मिनट में तैयार · 500+ टीमें" },
    cta: { primary: "14 दिन का ट्रायल", secondary: "डेमो बुक करें", seeProduct: "प्रोडक्ट देखें" },
    pricing: { recommended: "अनुशंसित", perUser: "प्रति उपयोगकर्ता", perUserSub: "केवल सक्रिय सीट्स के लिए भुगतान", flat: "मासिक फ्लैट", flatSub: "प्रति टियर निश्चित मूल्य", starter: "स्टार्टर", team: "टीम", growth: "ग्रोथ", scale: "स्केल", enterprise: "एंटरप्राइज़", free: "मुफ्त", letsTalk: "बात करें" },
    footer: { product: "उत्पाद", company: "कंपनी", resources: "संसाधन", legal: "कानूनी", copyright: "© WorkwrK. बेंगलुरु में बना।" },
  },
  ja: {
    nav: { features: "機能", industries: "業界", pricing: "料金", about: "会社情報", faq: "FAQ", signIn: "ログイン", startFree: "無料で始める", dashboard: "ダッシュボード" },
    hero: { kicker: "新機能 · AIがKRAを作成", trust: "G2で4.8 · クレジットカード不要 · 30分で開始 · 500以上のチーム" },
    cta: { primary: "14日間無料トライアル", secondary: "デモを予約", seeProduct: "製品を見る" },
    pricing: { recommended: "おすすめ", perUser: "ユーザー単位", perUserSub: "アクティブアカウントのみ", flat: "月額固定", flatSub: "プラン別固定料金", starter: "スターター", team: "チーム", growth: "グロース", scale: "スケール", enterprise: "エンタープライズ", free: "無料", letsTalk: "ご相談ください" },
    footer: { product: "製品", company: "会社", resources: "リソース", legal: "法的情報", copyright: "© WorkwrK. ベンガルール発。" },
  },
  ko: {
    nav: { features: "기능", industries: "산업", pricing: "요금제", about: "소개", faq: "FAQ", signIn: "로그인", startFree: "무료 시작", dashboard: "대시보드" },
    hero: { kicker: "신규 · AI가 작성한 KRA", trust: "G2에서 4.8 · 신용카드 불필요 · 30분 만에 시작 · 500+ 팀" },
    cta: { primary: "14일 무료 체험", secondary: "데모 예약", seeProduct: "제품 보기" },
    pricing: { recommended: "추천", perUser: "사용자별", perUserSub: "활성 계정만 지불", flat: "월정액", flatSub: "티어별 고정 가격", starter: "스타터", team: "팀", growth: "그로스", scale: "스케일", enterprise: "엔터프라이즈", free: "무료", letsTalk: "문의하기" },
    footer: { product: "제품", company: "회사", resources: "리소스", legal: "법적", copyright: "© WorkwrK. 벵갈루루에서 제작." },
  },
  zh: {
    nav: { features: "功能", industries: "行业", pricing: "价格", about: "关于", faq: "FAQ", signIn: "登录", startFree: "免费开始", dashboard: "仪表板" },
    hero: { kicker: "新功能 · AI 起草 KRA", trust: "G2 评分 4.8 · 无需信用卡 · 30 分钟内完成设置 · 500+ 团队" },
    cta: { primary: "14 天试用", secondary: "预约演示", seeProduct: "查看产品" },
    pricing: { recommended: "推荐", perUser: "按用户", perUserSub: "仅为活跃账户付费", flat: "月度固定", flatSub: "每层级固定价格", starter: "入门版", team: "团队版", growth: "成长版", scale: "规模版", enterprise: "企业版", free: "免费", letsTalk: "联系我们" },
    footer: { product: "产品", company: "公司", resources: "资源", legal: "法律", copyright: "© WorkwrK. 在班加罗尔打造。" },
  },
  ar: {
    nav: { features: "الميزات", industries: "القطاعات", pricing: "الأسعار", about: "عنا", faq: "الأسئلة الشائعة", signIn: "تسجيل الدخول", startFree: "ابدأ مجاناً", dashboard: "لوحة التحكم" },
    hero: { kicker: "جديد · KRAs صاغتها الذكاء الاصطناعي", trust: "4.8 على G2 · بدون بطاقة ائتمان · إعداد في 30 دقيقة · +500 فريق" },
    cta: { primary: "تجربة 14 يوماً", secondary: "احجز جولة", seeProduct: "شاهد المنتج" },
    pricing: { recommended: "موصى به", perUser: "لكل مستخدم", perUserSub: "ادفع فقط للحسابات النشطة", flat: "شهري ثابت", flatSub: "سعر ثابت لكل فئة", starter: "البداية", team: "الفريق", growth: "النمو", scale: "التوسع", enterprise: "المؤسسات", free: "مجاني", letsTalk: "لنتحدث" },
    footer: { product: "المنتج", company: "الشركة", resources: "الموارد", legal: "قانوني", copyright: "© WorkwrK. صُنع في بنغالور." },
  },
  he: {
    nav: { features: "תכונות", industries: "תעשיות", pricing: "תמחור", about: "אודות", faq: "שאלות נפוצות", signIn: "התחברות", startFree: "התחל חינם", dashboard: "לוח בקרה" },
    hero: { kicker: "חדש · KRAs שנכתבו על ידי AI", trust: "4.8 ב-G2 · ללא כרטיס אשראי · הגדרה ב-30 דקות · 500+ צוותים" },
    cta: { primary: "תקופת ניסיון 14 יום", secondary: "הזמן הדגמה", seeProduct: "ראה מוצר" },
    pricing: { recommended: "מומלץ", perUser: "לכל משתמש", perUserSub: "שלם רק על חשבונות פעילים", flat: "חודשי קבוע", flatSub: "מחיר קבוע לכל דרג", starter: "התחלה", team: "צוות", growth: "צמיחה", scale: "קנה מידה", enterprise: "ארגוני", free: "חינם", letsTalk: "בואו נדבר" },
    footer: { product: "מוצר", company: "חברה", resources: "משאבים", legal: "משפטי", copyright: "© WorkwrK. נבנה בבנגלור." },
  },
  it: {
    nav: { features: "Funzionalità", industries: "Settori", pricing: "Prezzi", about: "Chi siamo", faq: "FAQ", signIn: "Accedi", startFree: "Inizia gratis", dashboard: "Dashboard" },
    hero: { kicker: "Nuovo · KRA redatti dall'IA", trust: "4.8 su G2 · Nessuna carta · Pronto in 30 min · 500+ team" },
    cta: { primary: "Prova 14 giorni", secondary: "Prenota una demo", seeProduct: "Vedi il prodotto" },
    pricing: { recommended: "Consigliato", perUser: "Per utente", perUserSub: "paghi solo per account attivi", flat: "Mensile fisso", flatSub: "prezzo fisso per livello", starter: "Starter", team: "Team", growth: "Crescita", scale: "Scala", enterprise: "Enterprise", free: "Gratis", letsTalk: "Parliamone" },
    footer: { product: "Prodotto", company: "Azienda", resources: "Risorse", legal: "Legale", copyright: "© WorkwrK. Creato a Bengaluru." },
  },
  pt: {
    nav: { features: "Recursos", industries: "Indústrias", pricing: "Preços", about: "Sobre", faq: "FAQ", signIn: "Entrar", startFree: "Começar grátis", dashboard: "Painel" },
    hero: { kicker: "Novo · KRAs gerados por IA", trust: "4.8 no G2 · Sem cartão · Pronto em 30 min · 500+ equipes" },
    cta: { primary: "Teste 14 dias", secondary: "Agendar demo", seeProduct: "Ver o produto" },
    pricing: { recommended: "Recomendado", perUser: "Por usuário", perUserSub: "pague apenas por contas ativas", flat: "Mensal fixo", flatSub: "preço fixo por nível", starter: "Starter", team: "Time", growth: "Crescimento", scale: "Escala", enterprise: "Enterprise", free: "Grátis", letsTalk: "Vamos conversar" },
    footer: { product: "Produto", company: "Empresa", resources: "Recursos", legal: "Legal", copyright: "© WorkwrK. Feito em Bengaluru." },
  },
  nl: {
    nav: { features: "Functies", industries: "Sectoren", pricing: "Prijzen", about: "Over ons", faq: "FAQ", signIn: "Inloggen", startFree: "Gratis starten", dashboard: "Dashboard" },
    hero: { kicker: "Nieuw · KRAs door AI opgesteld", trust: "4.8 op G2 · Geen creditcard · 30 min om te starten · 500+ teams" },
    cta: { primary: "14-daagse proef", secondary: "Demo boeken", seeProduct: "Bekijk product" },
    pricing: { recommended: "Aanbevolen", perUser: "Per gebruiker", perUserSub: "betaal alleen voor actieve accounts", flat: "Maandelijks vast", flatSub: "vaste prijs per tier", starter: "Starter", team: "Team", growth: "Groei", scale: "Schaal", enterprise: "Enterprise", free: "Gratis", letsTalk: "Laten we praten" },
    footer: { product: "Product", company: "Bedrijf", resources: "Bronnen", legal: "Juridisch", copyright: "© WorkwrK. Gemaakt in Bengaluru." },
  },
  sv: {
    nav: { features: "Funktioner", industries: "Branscher", pricing: "Priser", about: "Om oss", faq: "FAQ", signIn: "Logga in", startFree: "Börja gratis", dashboard: "Dashboard" },
    hero: { kicker: "Nytt · KRAs skrivna av AI", trust: "4.8 på G2 · Inget kreditkort · 30 min att starta · 500+ team" },
    cta: { primary: "14-dagars provperiod", secondary: "Boka demo", seeProduct: "Se produkten" },
    pricing: { recommended: "Rekommenderas", perUser: "Per användare", perUserSub: "betala bara för aktiva konton", flat: "Månadsvis fast", flatSub: "fast pris per nivå", starter: "Starter", team: "Team", growth: "Tillväxt", scale: "Skala", enterprise: "Enterprise", free: "Gratis", letsTalk: "Prata med oss" },
    footer: { product: "Produkt", company: "Företag", resources: "Resurser", legal: "Juridiskt", copyright: "© WorkwrK. Gjort i Bengaluru." },
  },
  no: {
    nav: { features: "Funksjoner", industries: "Bransjer", pricing: "Priser", about: "Om oss", faq: "FAQ", signIn: "Logg inn", startFree: "Start gratis", dashboard: "Dashbord" },
    hero: { kicker: "Nytt · KRAs skrevet av AI", trust: "4.8 på G2 · Ingen kreditkort · 30 min for å starte · 500+ team" },
    cta: { primary: "14-dagers prøveperiode", secondary: "Bestill demo", seeProduct: "Se produktet" },
    pricing: { recommended: "Anbefalt", perUser: "Per bruker", perUserSub: "betal bare for aktive kontoer", flat: "Månedlig fast", flatSub: "fast pris per nivå", starter: "Starter", team: "Team", growth: "Vekst", scale: "Skala", enterprise: "Enterprise", free: "Gratis", letsTalk: "La oss snakke" },
    footer: { product: "Produkt", company: "Selskap", resources: "Ressurser", legal: "Juridisk", copyright: "© WorkwrK. Laget i Bengaluru." },
  },
  da: {
    nav: { features: "Funktioner", industries: "Brancher", pricing: "Priser", about: "Om os", faq: "FAQ", signIn: "Log ind", startFree: "Start gratis", dashboard: "Dashboard" },
    hero: { kicker: "Nyt · KRAs skrevet af AI", trust: "4.8 på G2 · Intet kreditkort · 30 min at starte · 500+ teams" },
    cta: { primary: "14-dages prøveperiode", secondary: "Book demo", seeProduct: "Se produktet" },
    pricing: { recommended: "Anbefalet", perUser: "Per bruger", perUserSub: "betal kun for aktive konti", flat: "Månedlig fast", flatSub: "fast pris per niveau", starter: "Starter", team: "Team", growth: "Vækst", scale: "Skala", enterprise: "Enterprise", free: "Gratis", letsTalk: "Lad os snakke" },
    footer: { product: "Produkt", company: "Firma", resources: "Ressourcer", legal: "Juridisk", copyright: "© WorkwrK. Lavet i Bengaluru." },
  },
  fi: {
    nav: { features: "Ominaisuudet", industries: "Toimialat", pricing: "Hinnoittelu", about: "Tietoa", faq: "UKK", signIn: "Kirjaudu", startFree: "Aloita ilmaiseksi", dashboard: "Hallintapaneeli" },
    hero: { kicker: "Uutta · Tekoälyn laatimat KRAt", trust: "4.8 G2:ssa · Ei luottokorttia · 30 min aloitukseen · 500+ tiimiä" },
    cta: { primary: "14 päivän kokeilu", secondary: "Varaa demo", seeProduct: "Katso tuote" },
    pricing: { recommended: "Suositus", perUser: "Per käyttäjä", perUserSub: "maksa vain aktiivisista tileistä", flat: "Kuukausikiinteä", flatSub: "kiinteä hinta per taso", starter: "Aloitus", team: "Tiimi", growth: "Kasvu", scale: "Skaalaus", enterprise: "Yritys", free: "Ilmainen", letsTalk: "Puhutaan" },
    footer: { product: "Tuote", company: "Yritys", resources: "Resurssit", legal: "Juridinen", copyright: "© WorkwrK. Tehty Bengalurussa." },
  },
  pl: {
    nav: { features: "Funkcje", industries: "Branże", pricing: "Cennik", about: "O nas", faq: "FAQ", signIn: "Zaloguj", startFree: "Rozpocznij bezpłatnie", dashboard: "Panel" },
    hero: { kicker: "Nowość · KRAs tworzone przez AI", trust: "4.8 w G2 · Bez karty · 30 min do startu · 500+ zespołów" },
    cta: { primary: "14-dniowy okres próbny", secondary: "Zarezerwuj demo", seeProduct: "Zobacz produkt" },
    pricing: { recommended: "Polecane", perUser: "Za użytkownika", perUserSub: "płać tylko za aktywne konta", flat: "Miesięcznie stałe", flatSub: "stała cena za poziom", starter: "Starter", team: "Zespół", growth: "Wzrost", scale: "Skala", enterprise: "Enterprise", free: "Za darmo", letsTalk: "Porozmawiajmy" },
    footer: { product: "Produkt", company: "Firma", resources: "Zasoby", legal: "Prawne", copyright: "© WorkwrK. Stworzone w Bengaluru." },
  },
};

const files = await fs.readdir(messagesDir);
for (const file of files) {
  if (!file.endsWith(".json")) continue;
  const locale = file.replace(/\.json$/, "");
  const full = path.join(messagesDir, file);
  const content = JSON.parse(await fs.readFile(full, "utf8"));
  const block = translations[locale] ?? translations.en;
  // Merge under marketing namespace, preserving anything already there
  content.marketing = { ...(content.marketing ?? {}), ...block };
  await fs.writeFile(full, JSON.stringify(content, null, 2) + "\n", "utf8");
  console.log(`✓ ${locale}`);
}
console.log("Done.");
