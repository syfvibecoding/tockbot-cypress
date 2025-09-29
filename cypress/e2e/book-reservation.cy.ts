/// <reference types="cypress" />

interface Reservation {
	bookingPage: string
	partySize: number
	desiredTimeSlots: string[]
	excludedDays: string[]
	desiredDays: string[]
	dryRun: boolean
}

interface Patron {
	email: string
	password: string
	cvv: string
}

interface Booking {
	day: string
	time: string
}

describe('book reservation', () => {
	
	let patron: Patron
	let reservation: Reservation
	
	before(() => {
		patron = {
			email: Cypress.env('email'),
			password: Cypress.env('password'),
			cvv: Cypress.env('cvv'),
		}
		cy.wrap(patron.email).should('be.ok')
		cy.wrap(patron.password).should('be.ok')
		cy.wrap(patron.cvv).should('be.a', 'string')
		cy.wrap(patron.cvv).should('match', /^[0-9]{3,4}$/)

		reservation = {
			partySize: Cypress.env('partySize'),
			bookingPage: Cypress.env('bookingPage'),
			desiredTimeSlots: Cypress.env('desiredTimeSlots'),
			excludedDays: Cypress.env('excludedDays'),
			desiredDays: Cypress.env('desiredDays'),
			dryRun: Cypress.env('dryRun'),
		}
		cy.wrap(reservation.bookingPage).should('be.ok')
		cy.wrap(reservation.partySize).should('be.a', 'number')
		cy.wrap(reservation.dryRun).should('be.a', 'boolean')
		cy.wrap(reservation.desiredTimeSlots).should('be.a', 'array')
		cy.wrap(reservation.excludedDays).should('be.a', 'array')
		cy.wrap(reservation.desiredDays).should('be.a', 'array')

	})

	const tid = (id:string, eq:string = '=') => `[data-testid${eq}${id}]`

	function closeTrusteModal() {
		if (!Cypress.env('trustee')) return
		cy.log(':cookie: closing truste modal...')
		return cy
			.get('#truste-consent-required')
			.click() 
	}

	function fetchAvailableDays() {
		cy.log(':mag: checking for days with openings...')
		return cy
			.get(tid('consumer-calendar-day'))
			.filter('[aria-disabled=false].is-available')
			.then((days) => cy.wrap(
				days.filter((i, el) => {
					const excludeFilter = reservation.excludedDays.length === 0 ||
						reservation.excludedDays.indexOf(el.ariaLabel) < 0
					const desiredFilter = reservation.desiredDays.length === 0 ||
						reservation.desiredDays.indexOf(el.ariaLabel) >= 0
					return excludeFilter && desiredFilter
				})
			))
	}

	function findMatchingTimeSlot(days:Array<HTMLElement>) {
		cy.wrap(days.length).should('be.greaterThan', 0) 
		cy.wrap(days[0]).click()
		return cy.get(`${tid('search-result-time')} span`).then((results) => {
			cy.log(`:crossed_fingers: checking ${results.length} slots on ${days[0].ariaLabel} for a match...`)
			const matchedPreferences = results
				.filter((i, el) => 
					reservation.desiredTimeSlots.length === 0 ||
					reservation.desiredTimeSlots.indexOf(el.innerText) >= 0)
			if (matchedPreferences.length === 0) {
				return findMatchingTimeSlot(days.slice(1))
			} else {
				return cy.wrap({
					booking: {
						day: days[0].ariaLabel,
						time: matchedPreferences[0].innerText
					},
					timeSlot: matchedPreferences[0]
				})
			}
		})
	}

	function authenticate() {
		cy.log(':house: navigating to booking page...')
		cy.get(tid('email-input')).type(patron.email)
		cy.get(tid('password-input')).type(patron.password)
		cy.log(':unlock: logging in...')
		cy.get(tid('signin')).click()
	}

	function visit() {
		const redirect = encodeURIComponent(`${reservation.bookingPage}?size=${reservation.partySize}`)
		cy.visit(`https://www.exploretock.com/login?continue=${redirect}`)
	}

	function fillFormFields(timeSlot:HTMLElement) {
		cy.wrap(timeSlot).click()
		return cy.get('.Consumer-contentContainer').then((body) => {
			const root = body.find('span#cvv')
			if (root.length) {
				cy.log(':credit_card: completing payment form...')
				cy.intercept('https://payments.braintree-api.com/graphql').as('braintree')
				cy.wait('@braintree')
				cy.get('iframe[type=cvv]')
					.its('0.contentDocument.body')
					.find('#cvv')
					.type(patron.cvv)
			} else {
				cy.log(':money_with_wings: no deposit required...')	
			}
			return cy.wrap(root.length > 0)
		})
	}

	function submitBooking() {
		cy.log(':handshake: booking reservation...')
		if (reservation.dryRun) {
			return cy.wrap('not booked, dry run mode enabled...')
		} else {		
			cy.get('[data-testid="purchase-button"]').click()
			return cy.get('[data-testid="receipt-confirmation-id"]', { timeout: 10000 }).then(p => {
				return cy.wrap(`booked! ${p.text()}`)
			})
		}
	}

	let confirmation: string

	after(() => {
		if (confirmation) cy.log({
			color: 'good',
			text: `:calendar: <!channel> ${confirmation}`
		} as unknown as string)
		else cy.log({
			color: 'danger',
			text: ':cry: no reservation booked'
		} as unknown as string)
	})

	it('for first available time preference', () => {
		confirmation = ''
		visit()
		closeTrusteModal()
		authenticate()
		fetchAvailableDays().then((days) => {
			cy.log(`:raised_hands: found ${days.length} days available for booking...`)
			return findMatchingTimeSlot(Array.from(days))
		}).then(({ booking, timeSlot }) => {
			cy.log(`:white_check_mark: found time slot for ${booking.day} @ ${booking.time}...`)
			return fillFormFields(timeSlot)
		})
		submitBooking().then((msg) => {
			confirmation = msg
		})
	})
})
