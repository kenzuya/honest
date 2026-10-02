import { describe, expect, test } from 'bun:test'
import { Layout, type SiteData } from './layout.component'

async function render(props: SiteData): Promise<string> {
	return String(await Layout(props))
}

describe('Layout', () => {
	test('renders custom meta tags as real attributes', async () => {
		const page = await render({
			title: 'Home',
			customMeta: [
				{ name: 'robots', property: '', content: 'noindex' },
				{ property: 'og:video', prefix: 'og: http://ogp.me/ns#', content: 'clip.mp4' }
			]
		})

		expect(page).toContain('<meta name="robots" content="noindex" />')
		expect(page).toContain('<meta property="og:video" prefix="og: http://ogp.me/ns#" content="clip.mp4" />')
	})

	test('escapes custom meta values', async () => {
		const page = await render({
			title: 'Home',
			customMeta: [{ name: 'description', property: '', content: '"><script>alert(1)</script>' }]
		})

		expect(page).toContain('content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"')
		expect(page).not.toContain('<script>alert(1)')
	})

	test('escapes attribute values and drops unsafe attribute names', async () => {
		const page = await render({
			title: 'Home',
			bodyAttributes: {
				'data-theme': 'a"b<c&d',
				'onload="alert(1)" x': 'y',
				hidden: true
			}
		})

		expect(page).toContain('<body data-theme="a&quot;b&lt;c&amp;d" hidden>')
		expect(page).not.toContain('alert(1)')
	})
})
