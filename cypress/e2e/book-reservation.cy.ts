/// <reference types="cypress" />

interface Reservation {
	bookingPage: string
	partySize: number
	desiredTimeSlots: string[]
	excludedDays: string[]
	desiredDays: string[]
	dryRun: boolean
	retryAttempts?: number
	retryDelay?: number
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
	let isAuthenticated: boolean = false
	
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
			retryAttempts: Cypress.env('retryAttempts') || 5,
			retryDelay: Cypress.env('retryDelay') || 10000,
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
			.get(tid('consumer-calendar-day'), { timeout: 5000 })
			.then((allDays) => {
				const availableDays = allDays.filter('[aria-disabled=false].is-available')
				cy.log(`:calendar: found ${availableDays.length} available days out of ${allDays.length} total days`)

				if (availableDays.length === 0) {
					cy.log(':x: no available days found')
					return cy.wrap([])
				}

				const filteredDays = availableDays.filter((i, el) => {
					const excludeFilter = reservation.excludedDays.length === 0 ||
						reservation.excludedDays.indexOf(el.ariaLabel) < 0
					const desiredFilter = reservation.desiredDays.length === 0 ||
						reservation.desiredDays.indexOf(el.ariaLabel) >= 0
					return excludeFilter && desiredFilter
				})
				cy.log(`:calendar: found ${filteredDays.length} matching days out of ${availableDays.length} available days`)
				return cy.wrap(filteredDays)
			})
	}

	function findMatchingTimeSlot(days:Array<HTMLElement>) {
		if (days.length === 0) {
			cy.log(':x: no days available to check for time slots')
			return cy.wrap(null)
		}

		// cy.wrap(days[0]).click()
		return cy.get(`${tid('search-result-time')} span`).then((results) => {
			cy.log(`:white_check_mark: found ${results.length} available slots on ${days[0].ariaLabel}, booking first one...`)
			if (results.length === 0) {
				if (days.length > 1) {
					return findMatchingTimeSlot(days.slice(1))
				} else {
					cy.log(':disappointed: no available time slots found on any available days')
					return cy.wrap(null)
				}
			} else {
				return cy.wrap({
					booking: {
						day: days[0].ariaLabel,
						time: results[0].innerText
					},
					timeSlot: results[0]
				})
			}
		})
	}

	function authenticate() {
		if (isAuthenticated) {
			cy.log(':white_check_mark: already authenticated, skipping login...')
			return cy.wrap(true)
		}

		cy.log(':house: navigating to booking page...')
		cy.get(tid('email-input')).type(patron.email)
		cy.get(tid('password-input')).type(patron.password)
		cy.log(':unlock: logging in...')
		return cy.get(tid('signin')).click().then(() => {
			// Wait for login to complete by checking for a post-login element
			return cy.get(tid('consumer-calendar-day'), { timeout: 10000 }).then(() => {
				isAuthenticated = true
				cy.log(':white_check_mark: authentication successful and saved')
				return cy.wrap(true)
			})
		})
	}

	function visit() {
		let bookingPath = `${reservation.bookingPage}?size=${reservation.partySize}`

		// If preferred days are available, use the first one and append date parameter
		if (reservation.desiredDays && reservation.desiredDays.length > 0) {
			const firstPreferredDay = reservation.desiredDays[0]
			bookingPath += `&date=${firstPreferredDay}`
			cy.log(`:calendar: navigating directly to preferred date: ${firstPreferredDay}`)
		}

		if (isAuthenticated) {
			cy.log(':fast_forward: already authenticated, going directly to booking page...')
			const bookingUrl = `https://www.exploretock.com${bookingPath}`
			cy.visit(bookingUrl)
		} else {
			const redirect = encodeURIComponent(bookingPath)
			cy.visit(`https://www.exploretock.com/login?continue=${redirect}`)
		}
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

	function attemptBooking(attemptNumber = 1) {
		cy.log(`:rocket: Attempt ${attemptNumber} of ${reservation.retryAttempts + 1}`)

		visit()
		closeTrusteModal()
		return authenticate().then(() => {
			// // If preferred days are available, skip calendar search and look for time slots directly
			// if (reservation.desiredDays && reservation.desiredDays.length > 0) {
			// 	cy.log(`:dart: skipping calendar search, looking for time slots on ${reservation.desiredDays[0]}`)

			// 	// Wait for SearchModal-body to be visible before proceeding
			// 	return cy.get('.SearchModal-body', { timeout: 5000 }).should('be.visible').then(($modal) => {
			// 		// Check if reservations have not opened yet within the SearchModal-body
			// 		if ($modal.text().includes('has not opened reservations')) {
			// 			cy.log(':clock1: reservations have not opened yet, retrying immediately...')
			// 			return cy.wait(100).then(() => {
			// 				return attemptBooking(attemptNumber + 1)
			// 			})
			// 		}

			// 		// Reservations are open, look for time slots
			// 		try {
			// 			return cy.get(`${tid('search-result-time')} span`, { timeout: 5000 }).should('be.visible').then((results) => {
			// 				if (results.length === 0) {
			// 					cy.log(':x: no time slots found on preferred date')
			// 					if (attemptNumber <= reservation.retryAttempts) {
			// 						cy.log(`:hourglass: waiting ${reservation.retryDelay}ms before retry (keeping auth session)...`)
			// 						return cy.wait(reservation.retryDelay).then(() => {
			// 							return attemptBooking(attemptNumber + 1)
			// 						})
			// 					} else {
			// 						cy.log(':cry: max retry attempts reached, no time slots found')
			// 						return cy.wrap('no time slots after retries')
			// 					}
			// 				}

			// 				cy.log(`:white_check_mark: found ${results.length} available slots on ${reservation.desiredDays[0]}, booking first one...`)
			// 				const timeSlot = results[0]
			// 				cy.log(`:white_check_mark: found time slot for ${reservation.desiredDays[0]} @ ${timeSlot.innerText}...`)
			// 				return fillFormFields(timeSlot).then(() => {
			// 					return submitBooking()
			// 				})
			// 			})
			// 		} catch (error) {
			// 			cy.log('Error occured searching for timeslot')
			// 			return attemptBooking(attemptNumber + 1)
			// 		}
			// 	})
			// } else {
				// No preferred days, use calendar search
				return fetchAvailableDays().then((days) => {
					if (days.length === 0) {
						cy.log(':x: no available days found')
						if (attemptNumber <= reservation.retryAttempts) {
							cy.log(`:hourglass: waiting ${reservation.retryDelay}ms before retry (keeping auth session)...`)
							return cy.wait(reservation.retryDelay).then(() => {
								return attemptBooking(attemptNumber + 1)
							})
						} else {
							cy.log(':cry: max retry attempts reached, no availability found')
							return cy.wrap('no availability after retries')
						}
					}

					cy.log(`:raised_hands: found ${days.length} days available for booking...`)
					return findMatchingTimeSlot(Array.from(days)).then((result) => {
						if (!result) {
							cy.log(':disappointed: no matching time slots found')
							if (attemptNumber <= reservation.retryAttempts) {
								cy.log(`:hourglass: waiting ${reservation.retryDelay}ms before retry (keeping auth session)...`)
								return cy.wait(reservation.retryDelay).then(() => {
									return attemptBooking(attemptNumber + 1)
								})
							} else {
								cy.log(':cry: max retry attempts reached, no matching slots found')
								return cy.wrap('no matching slots after retries')
							}
						}

						const { booking, timeSlot } = result
						cy.log(`:white_check_mark: found time slot for ${booking.day} @ ${booking.time}...`)
						return fillFormFields(timeSlot).then(() => {
							return submitBooking()
						})
					})
				})
			// }
		})
	}

	it('for first available time preference with retry logic', () => {
		confirmation = ''
		attemptBooking().then((result) => {
			confirmation = result
		})
	})
})
