import { DOWNLOAD_URL, type Locale, resolveCopy } from "@/content";
import { Closing } from "./closing";
import { Features } from "./features";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Models } from "./models";
import { Navbar } from "./navbar";
import { Privacy } from "./privacy";

export function LandingPage({ locale }: { locale: Locale }) {
	const copy = resolveCopy(locale);
	// Until installers are published, every download button leads to the
	// closing section, which explains availability.
	const downloadHref = DOWNLOAD_URL ?? "#download";

	return (
		<div className="min-h-screen overflow-x-clip">
			<Navbar locale={locale} copy={copy} downloadHref={downloadHref} />
			<main>
				<Hero locale={locale} copy={copy} downloadHref={downloadHref} />
				<Features locale={locale} copy={copy} />
				<Models locale={locale} copy={copy} />
				<Privacy locale={locale} copy={copy} />
				<Closing locale={locale} copy={copy} downloadUrl={DOWNLOAD_URL} />
			</main>
			<Footer copy={copy} />
		</div>
	);
}
