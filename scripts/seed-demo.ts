/**
 * Fills an empty site with a believable day of news, so the front page
 * can be judged (and demonstrated) before the newsroom has written
 * anything: three writers, fourteen stories across every section, cover
 * images, and a short comment thread on the lead.
 *
 *   npm run seed:demo
 *
 * Idempotent — a story whose slug already exists is left alone, so it is
 * safe to run again after cleaning up. Everything it creates uses the
 * fictional @dispatch.demo domain; remove it all with:
 *
 *   npm run seed:demo -- --remove
 *
 * Cover images are generated here with sharp rather than fetched: no
 * network, no licensing question, and they are written exactly the way
 * the upload pipeline writes real ones (see lib/storage.ts), so the
 * /media route serves them unchanged.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const DEMO_DOMAIN = "@dispatch.demo";
const LOCAL_UPLOADS = join(process.cwd(), ".local-uploads");

const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

const CATEGORIES = [
  { slug: "world", name: "World", description: "International news and reporting" },
  { slug: "politics", name: "Politics", description: "Government, policy and elections" },
  { slug: "business", name: "Business", description: "Markets, companies and the economy" },
  { slug: "technology", name: "Technology", description: "Tech industry and science" },
  { slug: "culture", name: "Culture", description: "Arts, media and society" },
  { slug: "sport", name: "Sport", description: "Results, analysis and features" },
];

const WRITERS = [
  { name: "Maya Okafor", handle: "maya-okafor", email: `maya${DEMO_DOMAIN}` },
  { name: "Daniel Reyes", handle: "daniel-reyes", email: `daniel${DEMO_DOMAIN}` },
  { name: "Priya Natarajan", handle: "priya-natarajan", email: `priya${DEMO_DOMAIN}` },
];

const READERS = [
  { name: "Tom Ashworth", handle: "tom-ashworth", email: `tom${DEMO_DOMAIN}` },
  { name: "Lena Fischer", handle: "lena-fischer", email: `lena${DEMO_DOMAIN}` },
];

interface Story {
  slug: string;
  title: string;
  dek: string;
  category: string;
  writer: number;
  hoursAgo: number;
  breaking?: boolean;
  cover?: { palette: [string, string]; caption: string };
  views: number;
  body: Array<{ type: "p" | "h2" | "quote"; text: string }>;
}

const STORIES: Story[] = [
  {
    slug: "council-approves-riverside-housing-plan",
    title: "Council approves riverside housing plan after five-hour debate",
    dek: "Twelve hundred homes, a new primary school and a promise on flood defences — but opponents say the numbers do not add up.",
    category: "politics",
    writer: 0,
    hoursAgo: 3,
    breaking: true,
    cover: { palette: ["#1f3a5f", "#6a8caf"], caption: "The riverside site seen from the old mill bridge." },
    views: 4820,
    body: [
      { type: "p", text: "The city council voted 31 to 18 late on Thursday to approve the largest housing development the district has seen in a generation, ending a debate that began in the afternoon and ran past eleven at night." },
      { type: "p", text: "The plan commits the developer to 1,200 homes on the former rail yards, of which 30 per cent must be offered at below-market rents, alongside a two-form-entry primary school and a riverside park. Construction is expected to begin next spring." },
      { type: "h2", text: "What was agreed" },
      { type: "p", text: "The most contested clause concerns flood protection. The developer will fund a new embankment along 800 metres of the river, but the council — not the developer — will own and maintain it. Councillors on the finance committee estimated the maintenance cost at £340,000 a year." },
      { type: "quote", text: "We are being asked to take on a liability for a hundred years so that someone else can take a profit for ten." },
      { type: "p", text: "Supporters countered that the school and the affordable homes would not be built without the scheme, and that the site had stood derelict for twenty-three years." },
      { type: "p", text: "A judicial review is being considered by the residents' association, which has until early December to lodge a claim." },
    ],
  },
  {
    slug: "central-bank-holds-rates-signals-cuts",
    title: "Central bank holds rates but signals cuts could come by spring",
    dek: "Policymakers voted 7–2 to keep borrowing costs unchanged, with the minutes showing growing unease about a slowing jobs market.",
    category: "business",
    writer: 1,
    hoursAgo: 6,
    cover: { palette: ["#3b2f2f", "#b08968"], caption: "The bank's headquarters on Thursday morning." },
    views: 3110,
    body: [
      { type: "p", text: "The central bank left its benchmark rate unchanged for a fourth consecutive meeting on Thursday, but the accompanying statement was noticeably softer than in September, dropping a reference to inflation being 'persistent'." },
      { type: "p", text: "Two members of the committee voted for an immediate quarter-point cut, up from one at the previous meeting. Markets moved to price in a first reduction by March." },
      { type: "h2", text: "A cooling jobs market" },
      { type: "p", text: "The minutes devote unusual space to employment. Vacancies have fallen for eleven straight months and the number of people out of work for more than six months has risen by a fifth since the summer." },
      { type: "p", text: "Mortgage lenders responded within hours: two of the five largest cut their fixed-rate deals by between 0.15 and 0.25 percentage points before the close of business." },
    ],
  },
  {
    slug: "open-source-model-beats-benchmarks",
    title: "An open-source model just beat the field on every benchmark that matters",
    dek: "A research collective with no venture funding has released weights that outperform the largest commercial systems on reasoning tests — and the licence lets anyone use them.",
    category: "technology",
    writer: 2,
    hoursAgo: 9,
    cover: { palette: ["#0f172a", "#38bdf8"], caption: "Training runs at the collective's shared cluster." },
    views: 6540,
    body: [
      { type: "p", text: "The release landed quietly on Tuesday night: a set of model weights, a forty-page technical report and a permissive licence. By Wednesday morning it was the most downloaded artefact on the largest model repository, and by the afternoon the first independent evaluations had confirmed what the report claimed." },
      { type: "p", text: "On the six reasoning benchmarks that researchers treat as the serious ones, the model scores above every commercial system whose results are public. On two of them the margin is not close." },
      { type: "h2", text: "How they did it" },
      { type: "p", text: "The report credits three things: a curated training set a tenth the size of what is typical, a long second phase of training on verified worked solutions, and — the authors are candid about this — a great deal of borrowed compute from a university consortium." },
      { type: "quote", text: "We did not have a bigger machine. We had better data and more patience." },
      { type: "p", text: "Whether the result holds up under the scrutiny that follows any headline claim is the question for the next month. Several teams have already announced replication attempts." },
    ],
  },
  {
    slug: "ceasefire-talks-resume-third-round",
    title: "Ceasefire talks resume for a third round as aid convoys wait at the border",
    dek: "Negotiators returned to the table on Wednesday with a draft that both sides describe, cautiously, as workable.",
    category: "world",
    writer: 0,
    hoursAgo: 14,
    cover: { palette: ["#4a3728", "#d4a373"], caption: "Trucks carrying medical supplies queued at the northern crossing on Tuesday." },
    views: 2890,
    body: [
      { type: "p", text: "Talks aimed at a lasting ceasefire resumed on Wednesday in the lakeside town that has hosted the previous two rounds, with mediators saying the gap between the parties had narrowed to 'a small number of hard questions'." },
      { type: "p", text: "The immediate concern is humanitarian. More than two hundred lorries carrying food, water purification units and medical supplies have been waiting at the northern crossing for six days, and aid agencies say stocks inside the region will run out within a week." },
      { type: "h2", text: "The sticking points" },
      { type: "p", text: "Three issues remain, according to two people briefed on the draft: the sequencing of prisoner releases, the status of a buffer zone along the river, and who verifies compliance. None is new. What has changed, the same people said, is that both sides now appear to want an agreement before winter." },
    ],
  },
  {
    slug: "national-theatre-new-season",
    title: "The National's new season bets everything on living writers",
    dek: "Not one revival in twelve productions — the boldest programme the theatre has announced in decades, and a direct answer to its critics.",
    category: "culture",
    writer: 2,
    hoursAgo: 20,
    cover: { palette: ["#3c1053", "#ad5389"], caption: "The Olivier stage during a technical rehearsal." },
    views: 1870,
    body: [
      { type: "p", text: "For years the complaint about the country's largest subsidised theatre has been that it plays safe: a Chekhov here, a musical transfer there, a star-led Shakespeare to keep the box office healthy. The season announced on Monday is a rebuttal." },
      { type: "p", text: "All twelve productions are new work by living writers, seven of them debuts on any of the theatre's three stages. The programme opens in February with a three-hour family drama set in a Grimsby fish market and closes, next autumn, with a verse play about the last days of a lighthouse keeper." },
      { type: "quote", text: "If we cannot take a risk with public money, what exactly is the public money for?" },
      { type: "p", text: "The artistic director, speaking at the launch, acknowledged the commercial gamble and said the theatre had budgeted for two of the twelve to fail at the box office." },
    ],
  },
  {
    slug: "city-win-derby-late-penalty",
    title: "City snatch the derby with a penalty in the 97th minute",
    dek: "A handball nobody in the ground saw, a VAR check that lasted four minutes, and a manager sent off before the kick was even taken.",
    category: "sport",
    writer: 1,
    hoursAgo: 26,
    cover: { palette: ["#14532d", "#4ade80"], caption: "The away end after the final whistle." },
    views: 8920,
    body: [
      { type: "p", text: "There were 96 minutes and 40 seconds on the clock when the ball struck a defender's arm at the far post. Play continued for another twenty seconds. Then the referee's hand went to his ear." },
      { type: "p", text: "What followed was the longest four minutes of the season: a review, a trip to the pitchside monitor, a penalty, and a red card for the home manager, who had walked onto the pitch to remonstrate. The kick itself was almost an afterthought, rolled into the bottom corner." },
      { type: "h2", text: "The table" },
      { type: "p", text: "The result lifts City to second, two points behind the leaders with a game in hand. United drop to sixth and have now taken one point from their last four matches." },
    ],
  },
  {
    slug: "electric-bus-fleet-doubles",
    title: "The electric bus fleet doubles — and the depots can't keep up",
    dek: "A hundred new vehicles arrive next month, but only sixty charging bays are ready. The operator says overnight rotation will cover the gap.",
    category: "business",
    writer: 0,
    hoursAgo: 31,
    views: 1420,
    body: [
      { type: "p", text: "The city's transport operator will take delivery of 100 electric buses in November, doubling its zero-emission fleet, but a Dispatch analysis of planning records shows that only 60 of the 120 charging bays needed have been built." },
      { type: "p", text: "The operator says the shortfall is temporary and that buses will be charged in two overnight shifts until the second depot opens in the spring. Drivers' representatives are sceptical, pointing out that the first shift would need to finish charging by 2 a.m." },
      { type: "p", text: "The fleet expansion is funded by a national grant that requires all vehicles to be in service by the end of the financial year." },
    ],
  },
  {
    slug: "coastal-erosion-village-relocation",
    title: "The village that voted to move itself inland",
    dek: "After a decade of losing gardens, then roads, then a church, residents chose relocation over a sea wall. Here is how they decided.",
    category: "world",
    writer: 2,
    hoursAgo: 40,
    cover: { palette: ["#1e3a8a", "#93c5fd"], caption: "What remains of the coast road, photographed at low tide." },
    views: 5230,
    body: [
      { type: "p", text: "The vote was not close. Of 312 households, 241 chose to accept the government's offer of new plots two miles inland over a sea wall that engineers gave a fifty-fifty chance of surviving thirty years." },
      { type: "p", text: "The decision makes this the first community in the country to opt for managed retreat by ballot rather than by evacuation order, and the process — eighteen months of meetings, models and arguments — is already being studied by three other councils along the same coast." },
      { type: "h2", text: "How the vote was run" },
      { type: "p", text: "Every household received the same 40-page briefing, written by the council's engineers and reviewed by a residents' panel. Two public meetings were held per month. The ballot itself was run by the electoral commission." },
      { type: "quote", text: "Nobody wanted to leave. What we wanted even less was to be the last ones standing on a road that ends in the sea." },
    ],
  },
  {
    slug: "hospital-waiting-times-fall",
    title: "Hospital waiting times fall for the first time in three years",
    dek: "The median wait for planned surgery dropped by eleven days in the last quarter. Officials credit weekend operating lists; unions credit the staff working them.",
    category: "politics",
    writer: 1,
    hoursAgo: 52,
    views: 2140,
    body: [
      { type: "p", text: "Figures published on Thursday show the median wait for planned surgery fell from 19.4 weeks to 17.8 weeks in the three months to September — the first quarterly fall since the pandemic backlog began to build." },
      { type: "p", text: "The improvement is concentrated in orthopaedics and ophthalmology, where hospitals have been running additional Saturday lists. Waits for cardiology and cancer diagnostics were broadly unchanged." },
      { type: "p", text: "The health secretary described the numbers as 'a turning point'. The main nursing union said the lists were being staffed by people working a sixth day and that the pace was 'not something anyone should mistake for a plan'." },
    ],
  },
  {
    slug: "quantum-error-correction-milestone",
    title: "Physicists keep a quantum bit alive for a full second — a hundred times the old record",
    dek: "The result, published on Wednesday, removes what many considered the hardest obstacle to a useful quantum computer.",
    category: "technology",
    writer: 2,
    hoursAgo: 60,
    cover: { palette: ["#312e81", "#a5b4fc"], caption: "The dilution refrigerator housing the experiment." },
    views: 3780,
    body: [
      { type: "p", text: "A logical qubit — a single unit of quantum information protected by error correction — has been kept stable for one second, according to a paper published on Wednesday. The previous record was eleven milliseconds." },
      { type: "p", text: "One second sounds brief. In a quantum computer it is an eternity: enough time to perform roughly a million operations, which is the threshold at which the machines begin to do things classical computers cannot." },
      { type: "h2", text: "Why it matters" },
      { type: "p", text: "Every quantum computer built so far has been limited by noise. Qubits lose their state in microseconds, and the standard remedy — spreading each logical qubit across many physical ones — has, until now, added almost as much error as it removed." },
    ],
  },
  {
    slug: "independent-bookshops-record-year",
    title: "Independent bookshops post their best year since records began",
    dek: "Forty-one new shops opened; nine closed. The trade body says the secret is simple: events, and a very good coffee machine.",
    category: "culture",
    writer: 0,
    hoursAgo: 75,
    cover: { palette: ["#7c2d12", "#fdba74"], caption: "A new opening on the high street, photographed on its first Saturday." },
    views: 1660,
    body: [
      { type: "p", text: "There are now 1,104 independent bookshops in the country, the highest number since the trade body began counting in 1995 and a net gain of 32 in a year when the high street as a whole lost shops." },
      { type: "p", text: "The typical new opening, according to the association's survey, is small — under 800 square feet — and does most of its business in the evening: author events, book clubs, and a licensed bar in more than a third of cases." },
      { type: "quote", text: "People do not come in for a book they could have delivered tomorrow. They come in for the room." },
    ],
  },
  {
    slug: "marathon-course-record-broken",
    title: "Course record falls by 41 seconds on a morning nobody expected it",
    dek: "Rain at the start, wind on the embankment, and still the fastest marathon this city has seen.",
    category: "sport",
    writer: 1,
    hoursAgo: 90,
    views: 2310,
    body: [
      { type: "p", text: "The forecast said no. The pacemakers, who dropped out at 30 kilometres well ahead of schedule, said maybe. The clock at the finish said 2:02:37 — forty-one seconds inside a course record that had stood for six years." },
      { type: "p", text: "The winner ran the second half faster than the first, a negative split of nearly a minute, and crossed the line looking as though he could have kept going." },
      { type: "p", text: "In the women's race a debutante finished third, the first time in the event's history that a runner has reached the podium in her first marathon." },
    ],
  },
  {
    slug: "school-phone-ban-first-term-results",
    title: "One term into the phone ban, schools report calmer corridors and a surge in library loans",
    dek: "A survey of 140 secondary schools finds most heads would not go back. Pupils are less sure.",
    category: "politics",
    writer: 2,
    hoursAgo: 110,
    cover: { palette: ["#0c4a6e", "#7dd3fc"], caption: "Lockers where phones are kept during the school day." },
    views: 2980,
    body: [
      { type: "p", text: "Nine in ten head teachers surveyed said behaviour had improved since phones were locked away at the start of the day, and eight in ten reported an increase in library use. Library loans at one school in the survey have tripled." },
      { type: "p", text: "Pupils were surveyed separately. A majority — 58 per cent — said the ban had made the day 'more boring'. A larger majority, 71 per cent, said they were sleeping better." },
    ],
  },
  {
    slug: "small-business-lending-review",
    title: "Lending to small firms has fallen for two years. A new review asks why",
    dek: "Banks say demand is weak. Businesses say the forms take a fortnight and the answer is usually no.",
    category: "business",
    writer: 0,
    hoursAgo: 130,
    views: 980,
    body: [
      { type: "p", text: "Net lending to businesses with fewer than fifty employees has fallen in each of the last eight quarters, according to figures from the banking association, and the government has ordered a review into the causes." },
      { type: "p", text: "The banks' explanation is that firms are choosing not to borrow while interest rates are high. The federation representing small businesses disputes this: its own survey found that a third of members who applied for a loan in the last year were refused, and a further quarter gave up before receiving an answer." },
    ],
  },
];

// ---------------------------------------------------------------------------

function paragraphNode(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function toTiptap(body: Story["body"]) {
  return {
    type: "doc",
    content: body.map((block) =>
      block.type === "h2"
        ? { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: block.text }] }
        : block.type === "quote"
          ? { type: "blockquote", content: [paragraphNode(block.text)] }
          : paragraphNode(block.text)
    ),
  };
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toHtml(body: Story["body"]) {
  return body
    .map((block) =>
      block.type === "h2"
        ? `<h2>${escapeHtml(block.text)}</h2>`
        : block.type === "quote"
          ? `<blockquote><p>${escapeHtml(block.text)}</p></blockquote>`
          : `<p>${escapeHtml(block.text)}</p>`
    )
    .join("");
}

/**
 * A 1600×900 cover: a diagonal gradient with a few soft shapes, in the
 * story's palette. Abstract on purpose — it reads as art direction
 * rather than a stock photo pretending to be the real thing.
 */
async function makeCover(palette: [string, string], seed: number): Promise<Buffer> {
  const shapes = Array.from({ length: 5 }, (_, i) => {
    const r = 180 + ((seed * 37 + i * 91) % 260);
    const cx = ((seed * 131 + i * 397) % 1600);
    const cy = ((seed * 71 + i * 233) % 900);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="white" fill-opacity="${0.05 + (i % 3) * 0.04}" />`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${palette[0]}" />
        <stop offset="1" stop-color="${palette[1]}" />
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#g)" />
    ${shapes}
    <rect x="0" y="780" width="1600" height="120" fill="black" fill-opacity="0.12" />
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function ensureUser(person: { name: string; handle: string; email: string }, role: "MODERATOR" | "READER") {
  const existing = await db.user.findUnique({ where: { email: person.email } });
  if (existing) return existing;
  return db.user.create({
    data: {
      email: person.email,
      name: person.name,
      handle: person.handle,
      role,
      emailVerifiedAt: new Date(),
      // Nobody logs in as these; the hash exists so the row is shaped like
      // a real account.
      passwordHash: await argon2.hash(randomBytes(24).toString("base64url"), { type: argon2.argon2id }),
    },
  });
}

async function remove() {
  const users = await db.user.findMany({ where: { email: { endsWith: DEMO_DOMAIN } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) {
    console.log("No demo content found.");
    return;
  }
  await db.notification.deleteMany({ where: { OR: [{ userId: { in: ids } }, { actorId: { in: ids } }] } });
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.reaction.deleteMany({ where: { userId: { in: ids } } });
  await db.bookmark.deleteMany({ where: { userId: { in: ids } } });
  await db.follow.deleteMany({ where: { followerId: { in: ids } } });
  await db.report.deleteMany({ where: { reporterId: { in: ids } } });
  await db.comment.deleteMany({ where: { userId: { in: ids } } });
  await db.article.deleteMany({ where: { authorId: { in: ids } } });
  await db.media.deleteMany({ where: { uploadedById: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.account.deleteMany({ where: { userId: { in: ids } } });
  const deleted = await db.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Removed ${deleted.count} demo accounts and everything they wrote.`);
}

async function seed() {
  for (const category of CATEGORIES) {
    await db.category.upsert({ where: { slug: category.slug }, create: category, update: {} });
  }
  const categories = new Map(
    (await db.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id])
  );

  const writers = [];
  for (const w of WRITERS) writers.push(await ensureUser(w, "MODERATOR"));
  const readers = [];
  for (const r of READERS) readers.push(await ensureUser(r, "READER"));

  await mkdir(LOCAL_UPLOADS, { recursive: true });

  let created = 0;
  for (const [index, story] of STORIES.entries()) {
    if (await db.article.findUnique({ where: { slug: story.slug }, select: { id: true } })) continue;

    const author = writers[story.writer]!;
    let coverImageId: string | undefined;

    if (story.cover) {
      const buffer = await makeCover(story.cover.palette, index + 1);
      const storageKey = `${randomUUID()}.jpg`;
      await writeFile(join(LOCAL_UPLOADS, storageKey), buffer);
      const media = await db.media.create({
        data: {
          type: "IMAGE",
          storageKey,
          url: `/media/${storageKey}`,
          contentType: "image/jpeg",
          altText: story.cover.caption,
          width: 1600,
          height: 900,
          checksum: createHash("sha256").update(buffer).digest("hex"),
          scanStatus: "CLEAN",
          uploadedById: author.id,
        },
      });
      coverImageId = media.id;
    }

    const bodyHtml = toHtml(story.body);
    const publishedAt = new Date(Date.now() - story.hoursAgo * 60 * 60 * 1000);

    const article = await db.article.create({
      data: {
        slug: story.slug,
        title: story.title,
        dek: story.dek,
        bodyJson: toTiptap(story.body),
        bodyHtml,
        searchText: story.body.map((b) => b.text).join("\n"),
        excerpt: story.dek,
        status: "PUBLISHED",
        isBreaking: story.breaking ?? false,
        viewCount: story.views,
        publishedAt,
        createdAt: publishedAt,
        authorId: author.id,
        categoryId: categories.get(story.category),
        coverImageId,
      },
    });
    created += 1;

    // A short, civil thread on the lead story, so the comment design has
    // something to show.
    if (index === 0) {
      const first = await db.comment.create({
        data: {
          articleId: article.id,
          userId: readers[0]!.id,
          body: "The maintenance figure is the part nobody is talking about. £340k a year, forever, is a school's worth of teaching assistants.",
          status: "APPROVED",
          createdAt: new Date(publishedAt.getTime() + 25 * 60 * 1000),
        },
      });
      await db.comment.create({
        data: {
          articleId: article.id,
          userId: readers[1]!.id,
          parentId: first.id,
          body: "True, but the site has been a fenced-off rail yard since I was at school. At some point something has to be built there.",
          status: "APPROVED",
          createdAt: new Date(publishedAt.getTime() + 48 * 60 * 1000),
        },
      });
      await db.comment.create({
        data: {
          articleId: article.id,
          userId: readers[1]!.id,
          body: "Good, clear reporting on the flood-defence clause. Would like a follow-up on whether the judicial review actually happens.",
          status: "APPROVED",
          createdAt: new Date(publishedAt.getTime() + 95 * 60 * 1000),
        },
      });
      await db.reaction.createMany({
        data: readers.map((r) => ({ articleId: article.id, userId: r.id })),
      });
    }
  }

  console.log(
    created
      ? `Created ${created} stories by ${WRITERS.length} writers, with covers in ${LOCAL_UPLOADS}.`
      : "Demo stories already exist; nothing added."
  );
}

async function main() {
  if (process.argv.includes("--remove")) await remove();
  else await seed();
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
