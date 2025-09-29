const { IncomingWebhook } = require('@slack/webhook');
const webhookUrl = Cypress.env('slackWebhookUrl');
const webhook = webhookUrl ? new IncomingWebhook(webhookUrl) : null;

Cypress.Commands.overwrite('log', (originalFn, ...msgs) => {
	if (webhook)
		msgs.forEach(text => {
			try {
				const payload = text.text ? text : { text }
				payload.username = Cypress.env('slackUsername')
				payload.icon_emoji = Cypress.env('slackIconEmoji')
				webhook.send(payload)
			} catch (error) {
				console.error('Failed to send webhook message:', error.message)
			}
		})
	return originalFn(...msgs);
})

Cypress.Commands.add('waitUntil', (fn, options) => {
	const { delay = 100, timeout = 4000 } = options || {}
	const start = new Date().getTime()
	const check = resolve => {
		const output = fn()
		if (output !== undefined) {
			resolve(output)
		} else if (new Date().getTime() - start > timeout) {
			throw new Error(`cy.waitUntil timed out after ${timeout}ms`)
		} else {
			setTimeout(() => check(resolve), delay)
		}
	}
	return new Cypress.Promise(resolve => check(resolve))
})