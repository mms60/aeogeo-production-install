#!/usr/bin/env python3
"""Add the six Technical Essentials guides to the bundle, Learn page, static pages and sitemap."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
APP = SITE / "assets" / "app.js"
LEARN = SITE / "learn.html"
BASE = "https://aeogeosearch.com"

P = 'mb-4 text-[0.97rem] leading-relaxed text-ice-300/75'
H2 = 'mt-10 mb-3 font-display text-xl font-extrabold tracking-tight text-white'
UL = 'mb-4 list-disc space-y-2 pl-5'


def p(text):
    return f'<p class="{P}">{text}</p>'


def h2(text):
    return f'<h2 class="{H2}">{text}</h2>'


def ul(items):
    return f'<ul class="{UL}">' + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


ARTICLES = [
    {
        "slug": "schema-org-ai-search",
        "num": "11",
        "card_title": "Schema.org for AI Search: The JSON-LD Types That Matter",
        "card_desc": "Which structured data AI systems actually read: Organization, LocalBusiness, Article, FAQPage, BreadcrumbList, and how to validate each one.",
        "level": "int",
        "time": "9 min read",
        "meta": "Which Schema.org JSON-LD types AI systems actually read, what each one proves, and how to validate your markup before shipping it.",
        "answer": "Structured data does not guarantee a citation, but it removes guesswork. JSON-LD tells AI systems what your business is, what a page covers, who wrote it, and which URL is canonical, using facts they can check against the visible page.",
        "takeaways": [
            "Put JSON-LD in the initial HTML, not injected later by client-side JavaScript.",
            "Use one Organization node, referenced by @id, with facts that match the visible page.",
            "dateModified should reflect real edits, not every deploy.",
        ],
        "paras": [
            p("AI systems do not read Schema.org the way Google reads rich-result markup. There is no switch that turns JSON-LD into a recommendation. What markup does is reduce ambiguity: it states your entity name, its relationships, and the facts behind a page in a format a machine can parse without inference."),
            h2("What structured data actually solves"),
            p("When an assistant summarizes a business, it has to decide which organization a page belongs to, which page is the canonical version, and whether a claim comes from the page or from somewhere else. Consistent JSON-LD answers those questions before the model starts guessing. It also connects your pages into one entity through @id values and sameAs links."),
            h2("The types that carry the most weight"),
            p("You do not need every type in the vocabulary. These cover most sites and most pages:"),
            ul([
                "<strong>Organization</strong>: name, url, logo, sameAs, address, areaServed and knowsAbout.",
                "<strong>LocalBusiness</strong>: for a physical location, with address, telephone, openingHours and geo.",
                "<strong>WebSite</strong>: site name and URL, which separates the brand from an individual page.",
                "<strong>BreadcrumbList</strong>: the page hierarchy and the name of each level.",
                "<strong>Article</strong> or <strong>BlogPosting</strong>: headline, author, datePublished, dateModified and image.",
                "<strong>Person</strong>: the author, with sameAs links to verifiable profiles.",
                "<strong>Service</strong> or <strong>Product</strong>: what you sell, who it is for, and the offer.",
                "<strong>FAQPage</strong>: question and answer pairs, with the caveat below.",
            ]),
            h2("The Organization node is the anchor"),
            p("Put one Organization node on the homepage and reference it by @id from every other page. Give it the same name, logo, phone, address and social profiles that appear in your footer and Google Business Profile. Mismatches between markup and visible content are worse than no markup, because they teach the system that your data is unreliable."),
            p("sameAs is not a ranking list. It is an identity list. Link only profiles that clearly belong to the same business."),
            h2("Article markup: dates and authorship"),
            p("For guides and articles, dateModified is the field AI systems use to judge freshness. Update it when the content actually changes, not on every deploy. Author markup should point to a real person or organization with a verifiable profile, not a generic byline."),
            h2("FAQPage markup: still useful, with limits"),
            p("Google restricted FAQ rich results in 2023 to a small set of authoritative government and health sites. That does not make FAQPage markup useless. The pairs still state questions and answers explicitly, which helps retrieval systems match a page to a query. Do not expect a rich result, and do not mark up questions that are not visible on the page."),
            h2("Mistakes that cancel the benefit"),
            ul([
                "Markup injected only by JavaScript after the page loads, where most AI crawlers never see it.",
                "Several Organization nodes that disagree about the name, phone number or address.",
                "Review markup for reviews that are not displayed on the page.",
                "Marking up URLs that are noindex, redirected or duplicated.",
                "Copying a template and leaving another company's @id or logo in place.",
            ]),
            h2("How to validate"),
            p("Run the URL through the Schema Markup Validator for syntax and the Rich Results Test for Google eligibility. Then view the raw HTML, not the rendered DOM, to confirm the JSON-LD is in the initial response. If your markup only appears after hydration, most crawlers will never see it."),
            p("Start with Organization, WebSite, BreadcrumbList and Article. Those four cover most sites and most pages. Add Service, LocalBusiness or Product where they genuinely describe what you offer. Keep every field true."),
        ],
    },
    {
        "slug": "robots-txt-ai-bots",
        "num": "12",
        "card_title": "robots.txt for AI Bots: GPTBot, ClaudeBot, PerplexityBot",
        "card_desc": "Many sites accidentally block the crawlers that feed AI answers. Allow, disallow, and verify rules for the major AI user-agents, with copy-paste examples.",
        "level": "int",
        "time": "6 min read",
        "meta": "How GPTBot, ClaudeBot, PerplexityBot and other AI crawlers read robots.txt, the rules that block them by accident, and how to verify access.",
        "answer": "robots.txt is a set of crawl requests, not a security control. It decides which URLs a bot may fetch. Blocking an AI crawler removes your pages from that crawler's reach, and many sites do it by accident.",
        "takeaways": [
            "robots.txt controls fetching, not access; it cannot protect private content.",
            "Search, training and user-triggered bots are separate decisions.",
            "Check CDN and WAF rules, because they can block crawlers before robots.txt matters.",
        ],
        "paras": [
            p("Every AI answer starts with a fetch. Before a model can quote your page, a crawler has to request it, and robots.txt is the first thing a well-behaved crawler reads. The file does not protect content, and it does not force a bot to leave. It is an instruction that reputable crawlers follow and others may ignore."),
            h2("What robots.txt can and cannot do"),
            ul([
                "It can allow or disallow paths for a named user agent, and it can point to sitemaps.",
                "It cannot require authentication, stop a scraper that ignores it, or hide a page from search results.",
                "It cannot control how another company's crawler treats your content.",
                "Crawl-delay is not supported by Google and is treated differently by other bots, so it is a weak traffic control.",
            ]),
            h2("The AI user agents worth knowing"),
            p("Names and products change, so confirm each rule against the provider's current documentation before you ship it."),
            ul([
                "<strong>GPTBot</strong>: OpenAI's crawler for model training.",
                "<strong>OAI-SearchBot</strong>: OpenAI's crawler for search results inside ChatGPT.",
                "<strong>ChatGPT-User</strong>: a live fetch triggered by a person's request.",
                "<strong>ClaudeBot</strong>: Anthropic's crawler.",
                "<strong>Claude-SearchBot</strong> and <strong>Claude-User</strong>: Anthropic's search and user-triggered fetches.",
                "<strong>PerplexityBot</strong>: Perplexity's index crawler.",
                "<strong>Perplexity-User</strong>: Perplexity's user-triggered fetch.",
                "<strong>Googlebot</strong>: Google Search.",
                "<strong>Google-Extended</strong>: controls Gemini and Vertex grounding use, not Google Search ranking.",
                "<strong>Bingbot</strong>: Bing and some Copilot surfaces.",
                "<strong>CCBot</strong>: Common Crawl, which feeds many research and training datasets.",
                "<strong>Applebot</strong> and <strong>Applebot-Extended</strong>: Apple search and AI use.",
                "<strong>Meta-ExternalAgent</strong>: Meta's crawler.",
            ]),
            h2("Search, training and user-triggered fetches are different"),
            p("Blocking GPTBot affects training collection. Blocking OAI-SearchBot affects whether ChatGPT can retrieve your pages for answers. Blocking ChatGPT-User can break a fetch a person just asked for. A single Disallow rule for all three is a blunt instrument that often removes visibility you wanted."),
            h2("A safe starting file"),
            p("Allow the crawlers you want, disallow only paths with no public value, and declare your sitemap. A short file is easier to review than a long one:"),
            ul([
                "User-agent: * with Allow: / and Disallow rules for /cart, /checkout, /account and internal search.",
                "An explicit Allow for the AI crawlers you want to reach your guides and service pages.",
                "A Sitemap line with the absolute URL of your sitemap index.",
                "No rule that disallows CSS, JavaScript or image paths wholesale.",
            ]),
            h2("Where AI blocks happen by accident"),
            ul([
                "A blanket Disallow: / left over from staging.",
                "A CDN bot-fight mode or a one-click block AI bots toggle that returns 403 before robots.txt is even read.",
                "WAF rules that challenge any request without a browser fingerprint.",
                "Security plugins that block user agents containing the word bot.",
                "A missing robots.txt that returns an HTML error page instead of a 404.",
            ]),
            h2("Verify with the request a crawler makes"),
            p("Fetch /robots.txt and confirm it returns 200 as text/plain. Then request a key page with the crawler's user agent and check the status code, not just the browser view. Server logs and Search Console crawl stats show what actually happened. If a CDN is returning 403 or an interstitial, fix that before editing robots.txt."),
            p("Keep the file short, review it after every CDN or security change, and treat each AI user agent as a separate decision."),
        ],
    },
    {
        "slug": "llms-txt",
        "num": "13",
        "card_title": "llms.txt Explained: The Emerging AI Crawler Standard",
        "card_desc": "A plain-language guide to the proposed llms.txt convention: what it does, what it cannot do, and whether your site should publish one.",
        "level": "beg",
        "time": "5 min read",
        "meta": "What llms.txt is, who proposed it, what it can and cannot do for AI visibility, and whether your site should publish one.",
        "answer": "llms.txt is a proposed Markdown file at /llms.txt that lists a site's most useful pages with short descriptions. It is not an official standard and no major AI provider guarantees reading it. Treat it as a cheap clarity layer, not a visibility switch.",
        "takeaways": [
            "llms.txt is a 2024 proposal, not an official standard.",
            "It helps most on large documentation libraries with clear canonical pages.",
            "It does not replace sitemaps, robots.txt or structured data.",
        ],
        "paras": [
            p("The idea is simple: give a language model a curated index of your site in plain Markdown, so it does not have to infer which pages matter from navigation and HTML. The proposal was published in September 2024 by Jeremy Howard of Answer.AI. It has since been adopted by some documentation sites and ignored by others."),
            h2("What the file looks like"),
            p("The convention is a Markdown file with an H1 for the project name, a blockquote summary, then H2 sections containing links and one-line notes. A companion llms-full.txt can hold the full text of key pages for systems that want more than a map."),
            h2("What it can do"),
            ul([
                "State which pages are canonical when several cover the same topic.",
                "Point to documentation, pricing and policy pages that are easy to miss in navigation.",
                "Give a short, quotable description of the business in plain language.",
            ]),
            h2("What it cannot do"),
            ul([
                "Guarantee that any model reads it.",
                "Replace robots.txt, sitemaps or structured data.",
                "Protect content or control training.",
                "Rank a page or earn a citation on its own.",
            ]),
            h2("Who should publish one"),
            p("Sites with a large, documentation-heavy library benefit most, because a curated index reduces the chance that a model picks an outdated page. Small sites with a dozen pages gain little; their sitemap and internal links already describe the structure. If your pages change often, an unmaintained llms.txt becomes another stale source of truth."),
            h2("A minimal example"),
            p("Start with the business name, one sentence on what you do and who you serve, then three to six sections such as Guides, Services, Pricing and Policies. Link only live, canonical URLs, and keep each note under one line. Put the file at the site root and serve it as text/plain or text/markdown."),
            h2("Measure it honestly"),
            p("AI crawler logs rarely identify llms.txt reads, and referral data will not isolate its effect. Treat it as an experiment with a low cost. Publish it, keep it current, and judge it by whether the pages you point to are the pages that get cited."),
            p("The file is a clarity aid. The work that moves visibility is still the content it points to."),
        ],
    },
    {
        "slug": "xml-sitemaps-ai-crawlers",
        "num": "14",
        "card_title": "XML Sitemaps and Crawl Depth for AI Crawlers",
        "card_desc": "AI bots crawl differently than Googlebot. How sitemap hygiene, internal linking, and shallow click depth get your best pages discovered.",
        "level": "int",
        "time": "6 min read",
        "meta": "How AI crawlers use XML sitemaps, why crawl depth matters, and the sitemap hygiene that gets your best pages discovered and re-read.",
        "answer": "A sitemap lists the URLs you want crawled and the date each one changed. For AI crawlers working with limited time, an accurate sitemap plus shallow internal links decides which pages get fetched at all.",
        "takeaways": [
            "Only canonical, indexable 200 pages belong in the sitemap.",
            "Accurate lastmod beats frequent lastmod.",
            "Important pages should be three clicks from the homepage.",
        ],
        "paras": [
            p("AI crawlers do not wander a site the way a person does. They start from a known URL, follow links, and stop when their budget runs out. A sitemap shortens that path. It tells the crawler what exists, which version is canonical, and when it last changed."),
            h2("Sitemap hygiene that matters"),
            ul([
                "Include only 200-status, indexable, canonical URLs.",
                "Exclude redirects, 404s, noindex pages and parameter duplicates.",
                "Set lastmod only when the content changed, not on every deploy.",
                "Keep each file under 50,000 URLs and 50 MB, and use a sitemap index when you need more.",
                "Reference the sitemap in robots.txt and submit it in Search Console and Bing Webmaster Tools.",
            ]),
            h2("Why lastmod is the field crawlers trust least"),
            p("If every URL gets today's date on every deploy, the field becomes noise and crawlers learn to ignore it. A sitemap that reports real edits gets re-fetched more efficiently, which matters when a page changes and you want the new version cited."),
            h2("Crawl depth is the other half"),
            p("A page four clicks from the homepage may never be fetched by a crawler with a small budget. Keep important pages within three clicks, link them from a hub, and use descriptive anchors. Orphan pages that exist only in the sitemap are discovered slowly, if at all."),
            h2("Internal links that help machines"),
            ul([
                "Link related guides to each other with descriptive anchor text.",
                "Use real anchor elements, not JavaScript-only menus.",
                "Keep breadcrumbs visible and marked up.",
                "Avoid nofollow on internal links you want followed.",
            ]),
            h2("Server behavior decides the rest"),
            p("A sitemap cannot compensate for slow or unstable responses. Pages that time out, redirect chains, cookie walls and soft 404s all waste the crawler's budget. Check status codes, response time and the initial HTML before adding more URLs."),
            h2("A monthly check"),
            p("Compare the sitemap against Search Console coverage, remove URLs that no longer return 200, confirm lastmod values match real edits, and spot-check that key pages are reachable in three clicks. That routine catches most crawl problems before they show up as missing citations."),
            p("The goal is not a bigger sitemap. It is a smaller, more accurate map of the pages you want read."),
        ],
    },
    {
        "slug": "page-speed-ai-crawlers",
        "num": "15",
        "card_title": "Page Speed and AI Crawlers: Don't Get Timed Out",
        "card_desc": "Crawler research shows slow responses get abandoned and never retried. The performance budget that keeps AI bots reading your pages.",
        "level": "adv",
        "time": "7 min read",
        "meta": "Slow pages get dropped by AI crawlers. The response-time budget, hosting causes, and fixes that keep bots reading your content.",
        "answer": "Crawlers give up on slow pages. If your HTML takes seconds to respond, AI systems fetch fewer pages, retry less, and may summarize from partial content. Speed is a crawl-budget problem before it is a ranking problem.",
        "takeaways": [
            "Most AI crawlers do not render JavaScript.",
            "Measure TTFB and the raw HTML, not just a Lighthouse score.",
            "Cache and server-render; never serve bots different content.",
        ],
        "paras": [
            p("A crawler is a client with a timeout. It sends a request, waits, and moves on. Most AI crawlers do not run a full browser, so they see the HTML your server returns, not the page your visitor sees after scripts run. If that response is slow or empty, the content may as well not exist."),
            h2("What slow looks like to a crawler"),
            ul([
                "Time to first byte above a second or two.",
                "HTML that waits on a database, a personalization layer or an API.",
                "Cold serverless starts on every fetch.",
                "Bot challenges and interstitial pages instead of content.",
                "Content that only appears after client-side rendering.",
            ]),
            h2("Put the answer in the first response"),
            p("Server-rendered HTML with the main text, headings and links is the most reliable format for AI crawlers. If your framework hydrates a client app, make sure the server still returns the article body. A page that requires JavaScript to show its content is a page many crawlers cannot read."),
            h2("The fixes that move TTFB"),
            ul([
                "Cache HTML at the edge and purge it on publish.",
                "Remove blocking third-party scripts from the critical path.",
                "Keep database queries off the request path where possible.",
                "Use a CDN close to your audience and to crawler regions.",
                "Compress responses and enable HTTP/2 or HTTP/3.",
            ]),
            h2("Rendering crawlers are not the same"),
            p("Googlebot can render JavaScript, though it queues the work. Most AI crawlers do not render at all. Optimizing only for Googlebot can leave your pages invisible to the systems you care about. Test with a plain HTTP request and read what comes back."),
            h2("Measure the right number"),
            p("PageSpeed Insights and CrUX tell you about real-user experience. They do not tell you what a crawler saw at 3 a.m. from a data center. Check server logs for crawler user agents, measure response time by path, and fetch key pages with curl to see the raw HTML and timing. Watch the 75th percentile of TTFB under crawl load, not just a lab score."),
            h2("Do not cloak"),
            p("Serving different content to bots than to people is cloaking and violates Google's policies. The goal is the same content, delivered faster and without a JavaScript dependency, not a special bot-only page."),
            p("A fast, server-rendered page with the content in the HTML is the version every crawler can use. That is the speed work that matters for AI visibility."),
        ],
    },
    {
        "slug": "meta-tags-ai-answers",
        "num": "16",
        "card_title": "Meta Tags and Open Graph for AI Answers",
        "card_desc": "Titles, descriptions, canonicals, and social cards: small tags with outsized influence on how machines summarize and share your pages.",
        "level": "beg",
        "time": "5 min read",
        "meta": "How titles, meta descriptions, canonicals and Open Graph tags shape AI answers and the links assistants show, with copy-ready rules.",
        "answer": "Titles and descriptions are the labels AI systems reuse when they name and link your page. Canonicals decide which URL gets credit. Open Graph tags shape the preview when a link is shared in a chat or an app.",
        "takeaways": [
            "Title, H1 and description should describe the same page.",
            "One canonical URL per topic, referenced consistently.",
            "Open Graph tags control how links look when shared.",
        ],
        "paras": [
            p("A model summarizing a page has to choose a name for it. The title tag, the H1 and the meta description are the shortest, most reliable statements of what the page is about. When they disagree, the system picks one and your page becomes harder to describe accurately."),
            h2("The title tag"),
            ul([
                "One clear topic, front-loaded.",
                "Brand at the end, separated by a pipe or hyphen.",
                "Under about 60 characters so it is not truncated.",
                "No keyword lists and no repeated city names.",
            ]),
            h2("The description is a summary, not a ranking lever"),
            p("Meta descriptions do not directly change rankings, but they are frequently reused in snippets and AI summaries. Write a plain sentence that states what the page covers and who it is for. Avoid claims the page does not support; a description that overpromises gets rewritten or ignored."),
            h2("Canonical tags"),
            p("One URL per topic. The canonical should be absolute, self-referencing on the canonical page, and consistent with internal links and the sitemap. If several URLs serve the same content, pick one and point the rest at it. Conflicting canonicals split signals and confuse retrieval."),
            h2("Robots meta tags"),
            p("Use index,follow on pages you want found. Check for noindex left over from staging, and remember that noindex also removes a page from AI retrieval. If you need to hide a page from search but keep it for users, use authentication instead of noindex."),
            h2("Open Graph and Twitter cards"),
            ul([
                "og:title and og:description, matching the page.",
                "og:image at 1200 by 630 pixels with a safe margin.",
                "og:url with the canonical URL.",
                "og:type, usually article or website.",
                "twitter:card set to summary_large_image.",
            ]),
            h2("Consistency is the point"),
            p("The title, description, H1 and first paragraph should describe the same page in the same terms. When an assistant quotes your description, it should still be true after the page changes. Review metadata whenever content changes, not only at launch."),
            p("Clear labels do not earn citations on their own. They make every citation that does happen more accurate."),
        ],
    },
]

TIME = {
    "schema-org-ai-search": "5 min read",
    "robots-txt-ai-bots": "5 min read",
    "llms-txt": "4 min read",
    "xml-sitemaps-ai-crawlers": "4 min read",
    "page-speed-ai-crawlers": "4 min read",
    "meta-tags-ai-answers": "4 min read",
}

# Sections added before each article's closing paragraph.
EXTRA = {
    "schema-org-ai-search": [
        h2("Where the markup belongs"),
        p("Put sitewide entities on the homepage: one Organization node and one WebSite node, linked by @id. Page-level types belong on the pages they describe: Article on a guide, Service on a service page, BreadcrumbList wherever there is a hierarchy. You can place them in one script tag with an @graph array or in several tags; both parse the same way."),
        p("Delivery matters more than layout. If a tag manager injects JSON-LD after a consent click, or a client-side router adds it after hydration, crawlers that do not execute JavaScript never see it. Render it with the page."),
        h2("What markup cannot fix"),
        p("Structured data does not create facts. If the phone number changes, the markup has to change with it. It will not compensate for thin content, a missing author, or a page that times out. It also cannot force a citation. It only makes the facts you already publish easier to reconcile, which is the part you control."),
        h2("A short monthly check"),
        p("Compare the Organization node with the footer, the Google Business Profile and LinkedIn. Confirm that every Article URL returns 200, that dateModified matches the visible update date, and that no page carries a second Organization node with different data. Five minutes of consistency work prevents most entity confusion."),
    ],
    "robots-txt-ai-bots": [
        h2("Crawl budget is not a fixed number"),
        p("Crawlers allocate requests by host, and large sites receive more of them. A site with thousands of parameter URLs, slow responses or long redirect chains spends that budget on pages nobody needs. Cleaning the crawl path often does more than adding rules."),
        h2("Do not block the files that explain the page"),
        p("Googlebot needs CSS and JavaScript to render, and the AI crawlers that do render need the same. Blocking /assets/, /static/ or image directories to save bandwidth can leave a page unreadable. If you need to limit crawling, target duplicate parameter URLs and internal search results instead."),
        h2("A review routine after every launch"),
        ul([
            "Fetch /robots.txt and confirm it returns 200 as text/plain.",
            "Request three key URLs with each AI user agent and check the status code.",
            "Check CDN and WAF logs for 403s or challenge pages served to crawlers.",
            "Confirm the Sitemap line points at a file that exists.",
            "Keep a dated copy so you can see what changed between launches.",
        ]),
    ],
    "llms-txt": [
        h2("How it fits with sitemaps and structured data"),
        p("A sitemap lists URLs. Structured data describes entities and page types. robots.txt sets crawl rules. llms.txt describes priority and meaning in prose. If the other three are wrong, llms.txt will not repair them. If they are right, it adds a small amount of clarity about which pages matter most."),
        h2("Common mistakes"),
        ul([
            "Listing every URL instead of a curated set.",
            "Linking pages that have moved, merged or been retired.",
            "Using marketing language where a description belongs.",
            "Repeating the same section for several topics.",
            "Serving the file behind authentication or client-side rendering.",
            "Expecting a ranking effect from the file itself.",
        ]),
        h2("Keeping it current"),
        p("Review the file when you publish or retire a major page. Ten accurate links beat a hundred stale ones. Add a date line if your process supports it, and keep the file out of the sitemap. The point is a short, trustworthy map, not another index to maintain."),
        h2("How to tell whether it is read"),
        p("Server logs may show requests for /llms.txt, but most AI crawlers do not advertise their purpose and some fetch through proxies. Treat a request as a weak signal, not proof that a model used the file. The stronger signal is whether the pages you list are the pages that get cited."),
    ],
    "xml-sitemaps-ai-crawlers": [
        h2("Single file or sitemap index"),
        p("A single sitemap is easiest to submit and debug. Once you pass a few thousand URLs, or you want separate files per section, use a sitemap index that points to child sitemaps. Keep each child focused, for example guides, services and location pages, so a failure is easy to isolate."),
        h2("When a page is missing from the index"),
        p("A URL in the sitemap is a request, not a guarantee. If a page is not indexed, check the status code, the canonical, the robots meta tag and whether the content is reachable by links. Then request indexing in Search Console or Bing Webmaster Tools. Adding the URL again does nothing if the page itself is the problem."),
        h2("What AI crawlers do with sitemaps"),
        p("Not every AI crawler reads sitemaps, and those that do may treat them as one input among several. The sitemap still helps because it is machine-readable, cheap to parse and explicit about lastmod. Pair it with internal links so a crawler that ignores sitemaps can still find the page."),
        h2("Priority and changefreq"),
        p("Google has said it ignores priority and changefreq. Other crawlers may read them, but no major system relies on them. Spend the effort on accurate lastmod and clean URLs instead."),
    ],
    "page-speed-ai-crawlers": [
        h2("Cache rules that help crawlers"),
        ul([
            "Cache HTML at the edge with a short TTL and purge on publish.",
            "Bypass the cache for signed-in users only, not for every request.",
            "Keep robots.txt and sitemaps cacheable.",
            "Serve compressed HTML rather than streaming it unbuffered.",
            "Avoid cache-busting query strings on internal links.",
        ]),
        h2("Images and third parties"),
        p("Images rarely cause a timeout by themselves, but a page that waits on a tag manager, a chat widget and three analytics scripts can. Load non-essential scripts after the content, self-host critical assets, and keep the initial HTML independent of third-party availability."),
        h2("When the bottleneck is bot protection"),
        p("A WAF that challenges requests without a browser fingerprint will stop crawlers before they read a word. Check the response code for a known crawler user agent from a data center, not from your laptop. If it returns 403 or a JavaScript challenge, fix the rule rather than the page."),
        h2("A simple test plan"),
        ul([
            "Fetch the page with curl and time the first byte.",
            "Confirm the main text is in that first response.",
            "Repeat from a second region to rule out a local cache.",
            "Check server logs for the crawler's user agent and status.",
            "Compare p75 TTFB before and after a caching change.",
        ]),
    ],
    "meta-tags-ai-answers": [
        h2("Titles that survive rewriting"),
        p("Search engines and AI systems rewrite titles when they are vague, stuffed or disconnected from the query. A specific title with the topic first and the brand last is less likely to be replaced. Avoid all-caps, repeated separators and the same title on every page."),
        h2("Descriptions that get quoted"),
        p("A good description reads like the first sentence of a summary: what the page covers, who it is for, and what the reader will get. It should make sense without the title. If it repeats the title word for word, it adds nothing."),
        h2("H1 and first paragraph"),
        p("The H1 and the opening paragraph are what a retrieval system reads first. Keep the H1 close to the title, and answer the page's main question in the first two sentences. A page that spends three paragraphs on background before stating its topic is harder to summarize."),
        h2("A pre-publish checklist"),
        ul([
            "Title under 60 characters and unique to the page.",
            "Description under 155 characters and specific.",
            "One canonical, self-referencing.",
            "index,follow unless the page is intentionally excluded.",
            "og:title, og:description, og:image and og:url set.",
            "H1 and first paragraph aligned with the title.",
        ]),
    ],
}

LEVEL_LABEL = {"beg": "Beginner", "int": "Intermediate", "adv": "Advanced"}
LEVEL_CLASS = {
    "beg": "text-royal-400 bg-royal-500/10",
    "int": "text-violet-300 bg-violet-500/15",
    "adv": "text-amber-300 bg-amber-500/15",
}


def js(value):
    return json.dumps(value, ensure_ascii=False)


def find_array_end(text, start):
    depth = 0
    in_str = False
    esc = False
    i = start
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    raise RuntimeError("unbalanced array")


def body_for(a):
    paras = a["paras"]
    return paras[:-1] + EXTRA.get(a["slug"], []) + paras[-1:]


def build_obj(a):
    return (
        "{anchor:%s,article:%s,tags:%s,title:%s,metaDescription:%s,answer:%s,paras:%s,takeaways:%s,hideSources:true}"
        % (
            js(a["slug"]),
            js("Article " + a["num"]),
            js(["Technical", TIME[a["slug"]]]),
            js(a["card_title"]),
            js(a["meta"]),
            js(a["answer"]),
            js(body_for(a)),
            js(a["takeaways"]),
        )
    )


def find_object_end(text, start):
    depth = 0
    in_str = False
    esc = False
    i = start
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    raise RuntimeError("unbalanced object")


def upsert_articles():
    s = APP.read_text()
    for a in ARTICLES:
        obj = build_obj(a)
        marker = '{anchor:"%s"' % a["slug"]
        idx = s.find(marker)
        if idx >= 0:
            end = find_object_end(s, idx)
            s = s[:idx] + obj + s[end + 1:]
        else:
            arr = s.index("Co=[") + 3
            end = find_array_end(s, arr)
            s = s[:end] + "," + obj + s[end:]
    APP.write_text(s)


def sync_card_times():
    s = APP.read_text()
    for a in ARTICLES:
        pat = re.compile(
            r'(\{title:"' + re.escape(a["card_title"]) + r'",desc:"(?:[^"\\]|\\.)*?",level:"[a-z]+",time:")([^"]*)(")'
        )
        s, n = pat.subn(lambda m: m.group(1) + TIME[a["slug"]] + m.group(3), s)
        assert n == 1, f"card time not synced: {a['slug']} ({n})"
    APP.write_text(s)


def patch_app():
    upsert_articles()
    if 'path:"/resources/schema-org-ai-search/"' not in APP.read_text():
        insert_routes(APP.read_text())
    add_card_hrefs(APP.read_text())
    sync_card_times()
    s = APP.read_text().replace('"/learn":"2026-11-17"', '"/learn":"2026-11-18"', 1)
    APP.write_text(s)


def insert_routes(s):
    route_needle = 'r.jsx(ct,{path:"/resources/measure-ai-visibility/",element:r.jsx(aeogeoStandaloneArticle,{anchor:"measure-ai-visibility"})}),'
    assert s.count(route_needle) == 1, "route anchor changed"
    routes = "".join(
        'r.jsx(ct,{path:"/resources/%s/",element:r.jsx(aeogeoStandaloneArticle,{anchor:"%s"})}),'
        % (a["slug"], a["slug"])
        for a in ARTICLES
    )
    s = s.replace(route_needle, route_needle + routes, 1)
    APP.write_text(s)


def add_card_hrefs(s):
    for a in ARTICLES:
        if f'href:"/resources/{a["slug"]}/"' in s:
            continue
        pat = re.compile(
            r'(\{title:"' + re.escape(a["card_title"]) + r'",desc:"(?:[^"\\]|\\.)*?",level:"[a-z]+",time:"[^"]*")\}'
        )
        s, n = pat.subn(r'\1,href:"/resources/' + a["slug"] + '/"}', s)
        assert n == 1, f"card not found exactly once: {a['slug']} ({n})"
    APP.write_text(s)


def learn_card(a):
    return (
        '<div style=opacity:1;transform:none><a href=/resources/%s/ class="group glass flex h-full flex-col rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-royal-400/50 hover:shadow-2xl hover:shadow-royal-600/20">'
        '<div class="mb-3 flex items-center gap-2"><span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 font-display text-[0.62rem] font-bold uppercase tracking-[0.12em] text-emerald-300"><span class="size-1.5 rounded-full bg-current"></span>Guide</span></div>'
        '<h3 class="font-display text-base font-bold leading-snug tracking-tight text-white">%s</h3>'
        '<p class="mt-2.5 flex-1 text-sm leading-relaxed text-ice-300/70">%s</p>'
        '<div class="mt-4 flex items-center gap-2"><span class="rounded-md px-2 py-1 text-[0.68rem] font-bold tracking-wide %s">%s</span><span class="ml-auto text-[0.7rem] text-ice-300/45">%s</span></div>'
        '<span class="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-royal-400">Read guide<svg xmlns=http://www.w3.org/2000/svg width=24 height=24 viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class="lucide lucide-arrow-right size-3.5 transition-transform duration-200 group-hover:translate-x-1" aria-hidden=true><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg></span></a></div>'
    ) % (
        a["slug"],
        a["card_title"],
        a["card_desc"],
        LEVEL_CLASS[a["level"]],
        LEVEL_LABEL[a["level"]],
        TIME[a["slug"]],
    )


def patch_learn():
    s = LEARN.read_text()

    nav_needle = '<a href=#strategy'
    assert s.count(nav_needle) == 1, "strategy nav link changed"
    nav = '<a href=#technical class="rounded-full border border-royal-500/15 bg-navy-900/60 px-4 py-2 text-sm font-semibold text-ice-300/75 transition-all hover:border-royal-400/50 hover:bg-royal-500/15 hover:text-white"><span class="mr-1.5 font-display text-[0.68rem] text-royal-400">04</span>Technical Essentials</a>'
    if "href=#technical" not in s:
        s = s.replace(nav_needle, nav + nav_needle, 1)

    section_needle = '<section id=strategy'
    assert s.count(section_needle) == 1, "strategy section changed"
    section = (
        '<section id=technical class="pt-10 pb-1" style=scroll-margin-top:6rem><div style=opacity:1;transform:none>'
        '<div class="flex flex-wrap items-baseline gap-3.5"><span class="font-display text-sm font-extrabold tracking-wide text-royal-500">04</span>'
        '<h2 class="font-display text-xl font-extrabold tracking-tight text-white sm:text-2xl">Technical Essentials</h2>'
        '<span class="rounded-full border border-royal-500/15 bg-royal-500/10 px-2.5 py-0.5 text-xs font-semibold text-royal-400">6 guides</span></div>'
        '<p class="mt-2 max-w-3xl text-sm text-ice-300/70">The plumbing: make sure AI crawlers can reach, read, and correctly interpret every page.</p></div>'
        '<div class="mt-5 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">'
        + "".join(learn_card(a) for a in ARTICLES)
        + "</div></section>"
    )
    existing = re.search(r"<section id=technical\b.*?</section>", s, re.S)
    if existing:
        s = s[: existing.start()] + section + s[existing.end() :]
    else:
        s = s.replace(section_needle, section + section_needle, 1)

    s = s.replace("13 guides and resources across 6 categories", "19 guides and resources across 7 categories", 1)
    s = s.replace('<b class="font-bold text-white">13</b> guides and resources', '<b class="font-bold text-white">19</b> guides and resources', 1)
    s = s.replace('<b class="font-bold text-white">6</b> learning categories', '<b class="font-bold text-white">7</b> learning categories', 1)

    blocks = list(re.finditer(r'<script type=application/ld\+json>(.*?)</script>', s, re.S))
    done = False
    for m in blocks:
        raw = m.group(1)
        if "aeogeosearch.com/learn" not in raw or '"CollectionPage"' not in raw:
            continue
        data = json.loads(raw)
        if data["mainEntity"]["numberOfItems"] == 19:
            done = True
            break
        data["description"] = "A 19-guide learning library covering GEO, AEO, AIO, SEO, and the AI Engine Optimization Method (AEOM), from beginner foundations to advanced strategy."
        data["dateModified"] = "2026-11-18"
        data["mainEntity"]["numberOfItems"] = 19
        items = data["mainEntity"]["itemListElement"]
        for a in ARTICLES:
            items.append({"@type": "ListItem", "position": len(items) + 1, "name": a["card_title"]})
        s = s[: m.start(1)] + json.dumps(data, ensure_ascii=False) + s[m.end(1):]
        done = True
        break
    assert done, "learn CollectionPage JSON-LD not found"
    LEARN.write_text(s)


def static_article(a):
    badge = (
        '<div class="mb-3.5 flex flex-wrap items-center gap-2.5">'
        '<span class="rounded-full border border-royal-500/20 bg-royal-500/12 px-3 py-1 font-display text-[0.7rem] font-bold uppercase tracking-[0.1em] text-royal-400">Article %s</span>'
        '<span class="rounded-full border border-royal-500/15 bg-navy-800/50 px-3 py-1 font-display text-[0.7rem] font-bold uppercase tracking-[0.1em] text-ice-300/70">Technical</span>'
        '<span class="rounded-full border border-royal-500/15 bg-navy-800/50 px-3 py-1 font-display text-[0.7rem] font-bold uppercase tracking-[0.1em] text-ice-300/70">%s</span></div>'
    ) % (a["num"], TIME[a["slug"]])
    takeaways = "".join(
        '<li class="flex gap-3 text-[0.92rem] text-ice-300/75"><span class="mt-1.5 size-2 shrink-0 rounded-full bg-royal-400" aria-hidden=true></span><span class="resource-prose">%s</span></li>'
        % t
        for t in a["takeaways"]
    )
    return (
        '<main class=flex-1><div class="relative bg-navy-950" data-aeogeo-standalone-article=%s>'
        '<div class="relative mx-auto max-w-5xl px-5 pt-36 pb-16 sm:px-8">'
        '<nav aria-label="Article navigation" class="mb-6 flex flex-wrap gap-4 text-sm">'
        '<a href=/resources class="font-semibold text-royal-400 underline underline-offset-4">Back to Resources</a>'
        '<a href=/learn class="font-semibold text-royal-400 underline underline-offset-4">Knowledge Library</a></nav>'
        '<div style=opacity:1;transform:none><article id=%s class="glass relative overflow-hidden rounded-3xl p-7 sm:p-10" style=scroll-margin-top:6rem>'
        '<div class="absolute inset-x-0 top-0 h-[3px]" aria-hidden=true style="background:linear-gradient(90deg,#2b4fc0,#4f7df9,transparent 70%%)"></div>'
        "%s"
        '<h1 class="font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">%s</h1>'
        '<p data-aeogeo-article-author=organization class="mt-3 text-sm text-ice-300/75">By AEOGEO Search</p>'
        '<div class="my-5 rounded-r-2xl border-l-[3px] border-royal-500 bg-royal-500/[0.09] px-5 py-4">'
        '<h2 class="mb-1.5 block font-display text-[0.68rem] font-bold uppercase tracking-[0.14em] text-royal-400">Quick answer</h2>'
        '<p class="m-0 font-medium text-ice-100">%s</p></div>'
        '<div class="resource-prose mb-4 text-[0.97rem] leading-relaxed text-ice-300/75">%s</div>'
        '<div class="mt-5 rounded-2xl border border-royal-500/15 bg-navy-950/50 px-5 py-4">'
        '<h2 class="mb-3 font-display text-base font-bold text-ice-200">Key takeaways</h2>'
        '<ul class="flex list-none flex-col gap-2.5 p-0">%s</ul></div>'
        '</article></div>'
        '<div data-aeogeo-resource-bottom-cta=%s class="mt-8 flex justify-center">'
        '<a href=/geo-audit/ class="btn-primary inline-flex items-center justify-center gap-2.5 rounded-xl px-7 py-3.5 font-display text-sm font-semibold text-white shadow-xl shadow-royal-600/40" style=background-color:#2b4fc0;min-height:48px;max-width:100%%;text-align:center>Start Your GEO Audit<span aria-hidden=true>&#8594;</span></a></div>'
        "</div>"
        '<script type=application/ld+json>%s</script></div></main>'
    ) % (
        a["slug"],
        a["slug"],
        badge,
        a["card_title"],
        a["answer"],
        "".join(body_for(a)),
        takeaways,
        a["slug"],
        json.dumps(
            {
                "@context": "https://schema.org",
                "@type": "Article",
                "headline": a["card_title"],
                "description": a["meta"],
                "url": f"{BASE}/resources/{a['slug']}/",
                "mainEntityOfPage": f"{BASE}/resources/{a['slug']}/",
                "isPartOf": {"@type": "CollectionPage", "url": f"{BASE}/resources"},
                "author": {
                    "@type": "Organization",
                    "@id": f"{BASE}/#organization",
                    "name": "AEOGEO Search",
                },
            },
            ensure_ascii=False,
        ),
    )


def build_static():
    tpl = (SITE / "resources" / "what-is-aeo" / "index.html").read_text()
    body_at = tpl.index("<body")
    main_at = tpl.index("<main", body_at)
    tail_at = tpl.rindex("</main>")
    header = tpl[body_at:main_at]
    tail = tpl[tail_at:]
    head = """<!doctype html><html lang=en-US><head>
<meta charset=utf-8>
<meta content="width=device-width,initial-scale=1" name=viewport>
<meta content=#050b1f name=theme-color>
<meta content=index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1 name=robots>
<meta content="AEOGEO Search" property=og:site_name>
<meta content=en_US property=og:locale>
<meta content=https://aeogeosearch.com/images/bg-ai-circles.jpg property=og:image>
<meta content=summary_large_image name=twitter:card>
<meta content=https://aeogeosearch.com/images/bg-ai-circles.jpg name=twitter:image>
<title>{title} | AEOGEO Search</title>
<meta name=description content="{desc}">
<link href={url} rel=canonical>
<meta content=article property=og:type>
<meta content="{title} | AEOGEO Search" property=og:title>
<meta content="{desc}" property=og:description>
<meta content={url} property=og:url>
<meta content="{title} | AEOGEO Search" name=twitter:title>
<meta content="{desc}" name=twitter:description>
<script type=application/ld+json>{"@context":"https://schema.org","@type":"ProfessionalService","@id":"https://aeogeosearch.com/#organization","name":"AEOGEO Search","description":"AIO, GEO, AEO, and SEO agency helping businesses rank higher in AI answers, traditional search, and local map packs.","url":"https://aeogeosearch.com/","telephone":"+1-469-905-2836","image":"https://aeogeosearch.com/images/bg-ai-circles.webp","priceRange":"$","address":{"@type":"PostalAddress","addressLocality":"McKinney","addressRegion":"TX","addressCountry":"US","postalCode":"75072"},"areaServed":[{"@type":"Place","name":"McKinney, Texas"},{"@type":"Country","name":"United States"}],"knowsAbout":["AI Search Optimization","Answer Engine Optimization","Generative Engine Optimization","Search Engine Optimization","Local SEO"],"logo":"https://aeogeosearch.com/images/aeogeo-header-logo.png"}</script>
<script src="/assets/app.js?nav=footeraccordion1" type=module></script>
<link href=/assets/site.css rel="stylesheet">\n<link rel="stylesheet" href="/assets/typography-consistency.css?v=tap45">
<link href=https://fonts.googleapis.com rel=preconnect>
<link crossorigin="" href=https://fonts.gstatic.com rel=preconnect>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Sora:wght@400;500;600;700;800&amp;display=swap" media=all onload='this.media="all"' rel="stylesheet">
</head>"""
    for a in ARTICLES:
        url = f"{BASE}/resources/{a['slug']}/"
        page = (
            head.replace("{title}", a["card_title"]).replace("{desc}", a["meta"]).replace("{url}", url)
            + header
            + static_article(a)
            + tail
        )
        out = SITE / "resources" / a["slug"] / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page)


def patch_sitemap():
    sm = SITE / "sitemap.xml"
    s = sm.read_text()
    for a in ARTICLES:
        url = f"{BASE}/resources/{a['slug']}/"
        if f"<loc>{url}</loc>" in s:
            continue
        s = s.replace("</urlset>", f"<url><loc>{url}</loc></url>\n</urlset>", 1)
    sm.write_text(s)


patch_app()
patch_learn()
build_static()
patch_sitemap()
print("patched app.js, learn.html, 6 static pages, sitemap")
