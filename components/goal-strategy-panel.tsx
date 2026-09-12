"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { deleteGoalStrategyAction, generateGoalFlightStageAction, generateGoalHotelStageAction, finalizeGoalStrategyRunAction } from "@/lib/goals/strategyActions";
import type { PersonalizedStrategy, StrategyAwardOption } from "@/lib/goals/strategyTypes";
import type { Goal } from "@/lib/goals/types";
import { buildCustomerSafeStrategyPresentation, type CustomerSafeStrategyPresentation, type CustomerSafeEstimate, type CustomerSafeHotelPlanningEstimateOption, type CustomerSafeTripRealityCard } from "@/lib/goals/customerSafeStrategyPresentation";
import { normalizePersistedStrategyTimestamp, transitionStrategyTimestamp } from "@/lib/goals/customerSafeStrategyTimestamp";
import { buildCustomerSafeGoalSummary, buildCustomerSafePlanningPreview, type CustomerSafePlanningPreview } from "@/lib/goals/customerSafeGoalSummary";
import {
  buildStrategyFailureMessage,
  buildStrategyPreviewPresentation,
  buildStrategyProgressPresentation,
  createInitialStrategyPanelRunState,
  isStrategyRetryAvailable,
  transitionStrategyPanelRun,
  type StrategyPanelRunState,
} from "@/lib/goals/strategyPanelLifecycle";

function PreviewCard({ preview }: { preview: CustomerSafePlanningPreview }) {
  return <li className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-white">{preview.programName}</span><span className="text-sm font-semibold text-white">{preview.pointsRequired === null ? "Amount not confirmed" : `${new Intl.NumberFormat("en-US").format(preview.pointsRequired)} points`}</span></div><p className="mt-1 text-sm text-slate-300">{preview.evidenceLabel} · {preview.availabilityLabel}</p>{preview.itineraryLabel ? <p className="mt-1 text-sm text-slate-300">{preview.itineraryLabel}</p> : null}<p className="mt-1 text-sm text-slate-300">{preview.pricingLabel} · {preview.coverageLabel}</p>{preview.feesLabel ? <p className="mt-1 text-sm text-slate-300">{preview.feesLabel}</p> : null}</li>;
}

function StagedPreviewLists({ flightOptions, hotelOptions }: { flightOptions: StrategyAwardOption[]; hotelOptions: StrategyAwardOption[] }) {
  return <>
    {flightOptions.length > 0 ? <div><p className="text-sm text-slate-300">Flight planning estimates</p><ul className="mt-2 space-y-2">{flightOptions.slice(0, 3).map((option, index) => <PreviewCard key={`flight-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `flight-preview-${index + 1}`)} />)}</ul></div> : null}
    {hotelOptions.length > 0 ? <div><p className="text-sm text-slate-300">Hotel planning estimates</p><ul className="mt-2 space-y-2">{hotelOptions.slice(0, 3).map((option, index) => <PreviewCard key={`hotel-preview-${index}`} preview={buildCustomerSafePlanningPreview(option, `hotel-preview-${index + 1}`)} />)}</ul></div> : null}
  </>;
}

const focusStyle = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300";
const cardStyle = "rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6";

function points(value: number | null): string {
  return value === null ? "Amount not confirmed" : `${new Intl.NumberFormat("en-US").format(value)} points`;
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="rounded-xl border border-slate-700 p-4">
    <button type="button" className={`min-h-11 w-full text-left font-medium text-white ${focusStyle}`} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>{label}<span aria-hidden="true" className="float-right ml-3">{expanded ? "−" : "+"}</span></button>
    <div id={id} hidden={!expanded} className="mt-3 space-y-3">{children}</div>
  </div>;
}

function PointsEstimate({ estimate }: { estimate: CustomerSafeEstimate }) {
  return <article className="rounded-xl border border-slate-700 p-4">
    <h4 className="font-semibold text-white">{estimate.programName}</h4>
    <p className="mt-2 font-semibold text-white">{points(estimate.pointsRequired)}</p>
    <p className="mt-1 text-sm text-slate-300">{estimate.redemptionLabel} · {estimate.pricingLabel} · {estimate.evidenceLabel}</p>
    {estimate.itineraryLabel ? <p className="mt-2 text-sm text-slate-200">{estimate.itineraryLabel}</p> : null}
    <p className="mt-2 text-sm text-slate-300">{estimate.availabilityLabel}{estimate.cashFees !== null ? ` · Fees: ${estimate.cashFees}` : ""}{estimate.seats !== null ? ` · Seats: ${estimate.seats}` : ""}</p>
    <p className="mt-1 text-sm text-slate-300">{estimate.coverageLabel}{estimate.travelerCountCovered !== null ? ` · ${estimate.travelerCountCovered} travelers` : ""}{estimate.nightCountCovered !== null ? ` · ${estimate.nightCountCovered} nights` : ""}</p>
  </article>;
}

function HotelImage({ option }: { option: CustomerSafeHotelPlanningEstimateOption }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return option.imageUrl && failedUrl !== option.imageUrl
    // Validated remote images have no configured optimization host; omit referrer data.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={option.imageUrl} alt={`Property photo of ${option.propertyName}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(option.imageUrl)} className="aspect-[16/9] w-full object-cover" />
    : <div className="flex aspect-[16/9] items-center justify-center bg-slate-800 p-4 text-sm text-slate-300">Photo unavailable</div>;
}

function TravelEvidence({ presentation, kind }: { presentation: CustomerSafeStrategyPresentation; kind: "flight" | "hotel" }) {
  return <>
    {presentation.currentCash.filter((quote) => quote.kind === kind).map((quote) => <article key={quote.key} className={cardStyle}>
      <h4 className="font-semibold text-white">{quote.sourceLabel}</h4><p className="mt-2 text-xl font-semibold text-white">{quote.priceLabel}</p>
      <p className="mt-1 text-sm text-slate-300">{quote.evidenceLabel} · {quote.coverageLabel}</p>
      {quote.datesLabel ? <p className="mt-2 text-sm text-slate-200">{quote.datesLabel}</p> : null}
      <p className="mt-2 text-sm text-slate-300">{[quote.taxesLabel, quote.cancellationLabel, quote.baggageLabel].filter(Boolean).join(" · ")}</p>
      {quote.unknownCount > 0 ? <p className="mt-2 text-sm text-amber-200">{quote.unknownCount} details not confirmed</p> : null}
    </article>)}
    {presentation.customerVerified.filter((option) => option.kind === kind).map((option) => <article key={option.key} className={cardStyle}>
      <h4 className="font-semibold text-white">{option.evidenceLabel}</h4><p className="mt-2 text-slate-200">{option.summary}</p>
      {option.confirmedAtLabel ? <p className="mt-2 text-sm text-slate-300">Confirmed {option.confirmedAtLabel}</p> : null}
      {option.unknownCount > 0 ? <p className="mt-2 text-sm text-amber-200">{option.unknownCount} details not confirmed</p> : null}
    </article>)}
  </>;
}

// Quote labels already carry their price basis. Never infer comparability,
// choose a quote, or convert coverage into a party/stay total here.
function CashQuoteOverview({ quotes }: { quotes: CustomerSafeStrategyPresentation["currentCash"] }) {
  return <ul className="mt-2 space-y-4">{quotes.map((quote) => <li key={quote.key}>
    <p className="font-medium text-white">{quote.sourceLabel}</p>
    <p className="mt-1 text-2xl font-semibold text-white">{quote.priceLabel}</p>
    <p className="mt-1 text-sm text-slate-300">{quote.evidenceLabel} · {quote.coverageLabel}</p>
    <p className="mt-1 text-sm text-slate-300">{quote.datesLabel ?? "Quote dates not confirmed"}</p>
  </li>)}</ul>;
}

/**
 * Trip Reality Card section. Every value is fixed server-owned copy projected
 * by the presentation boundary; the component renders labels only and never
 * composes figures itself.
 */
function TripRealitySection({ card }: { card: CustomerSafeTripRealityCard }) {
  return <section className="space-y-4" aria-label="Trip reality overview">
    <h3 className="text-xl font-semibold text-white">{card.label}</h3>
    <div className="grid gap-4 md:grid-cols-2">
      <div className={`${cardStyle} border-sky-400/40`}>
        <p className="text-sm text-sky-200">Paying cash</p>
        {card.cash.status === "available" && card.cash.amountLabel ? <>
          <p className="mt-2 text-2xl font-semibold text-white">{card.cash.amountLabel}</p>
          {card.cash.travelersLabel ? <p className="mt-1 text-sm text-slate-300">{card.cash.travelersLabel}</p> : null}
        </> : <p className="mt-2 text-2xl font-semibold text-white">Cash total not confirmed</p>}
      </div>
      <div className={cardStyle}>
        <p className="text-sm text-sky-200">Booking with points</p>
        {card.points.status === "available" && card.points.pointsLabel ? <>
          <p className="mt-2 text-2xl font-semibold text-white">{card.points.pointsLabel}</p>
          <p className="mt-1 text-sm text-slate-300">{card.points.programName} · {card.points.pricingLabel}</p>
          {card.points.feesLabel ? <p className="mt-1 text-sm text-slate-300">{card.points.feesLabel}</p> : null}
        </> : card.points.unavailableReason ? <p className="mt-2 text-sm text-slate-300">{card.points.unavailableReason}</p> : <p className="mt-2 text-2xl font-semibold text-white">Points requirement not confirmed</p>}
      </div>
    </div>
    {card.funding ? <div className="rounded-xl bg-sky-400/10 p-4">
      <h4 className="font-semibold text-sky-100">Can your points cover it?</h4>
      <p className="mt-1 text-sm leading-relaxed text-slate-200">{card.funding.statusLabel}{card.funding.programName ? ` (${card.funding.programName})` : ""}{card.funding.surplusLabel ? ` — ${card.funding.surplusLabel}` : ""}{card.funding.bestPointsLabel ? `. ${card.funding.bestPointsLabel}.` : ""}</p>
    </div> : null}
    {card.bestCard ? <div className="rounded-xl border border-slate-700 p-4">
      <h4 className="font-semibold text-white">Card to pay with</h4>
      <p className="mt-1 text-sm leading-relaxed text-slate-200">{card.bestCard.cardName}{card.bestCard.monthlyLabel ? ` — ${card.bestCard.monthlyLabel}` : ""}{card.bestCard.comparisonLabel ? ` (${card.bestCard.comparisonLabel})` : ""}</p>
    </div> : card.bestCardHint ? <p className="text-sm text-slate-300">{card.bestCardHint}</p> : null}
    {card.warnings.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">{card.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    <p className="text-xs text-slate-400">{card.disclosure}</p>
  </section>;
}

function savedResultStatus(presentation: CustomerSafeStrategyPresentation | null): string {
  if (!presentation) return "No saved plan yet.";
  const hasFlight = presentation.flightPlanningEstimate !== null || presentation.currentCash.some((quote) => quote.kind === "flight") || presentation.customerVerified.some((option) => option.kind === "flight");
  const hasHotel = presentation.hotelPlanningEstimate !== null || presentation.currentCash.some((quote) => quote.kind === "hotel") || presentation.customerVerified.some((option) => option.kind === "hotel");
  if (hasFlight && hasHotel) return "Plan saved. Flight and hotel results are ready to review. Check prices, coverage, and availability before booking.";
  if (hasFlight) return "Partial results saved. Flight results found; no hotel search results saved. Review important details before acting.";
  if (hasHotel) return "Partial results saved. Hotel results found; no flight search results saved. Review important details before acting.";
  return "Plan saved without flight or hotel search results. Review rewards planning and important details; prices and availability still need checking.";
}

function PlanResults({ presentation, isPrevious }: { presentation: CustomerSafeStrategyPresentation; isPrevious: boolean }) {
  const flight = presentation.flightPlanningEstimate;
  const hotel = presentation.hotelPlanningEstimate;
  const flightQuotes = presentation.currentCash.filter((quote) => quote.kind === "flight");
  const hotelQuotes = presentation.currentCash.filter((quote) => quote.kind === "hotel");
  const disclosures = [...new Set([
    "Planning guidance based on your saved goal, not a booking recommendation.",
    "Planning estimates may not match every constraint. Check current details before acting.",
    "Refresh updates your planning research. Check current availability before acting.",
    ...(flight ? [flight.availabilityLabel, ...flight.unknowns.map((item) => `Flight detail not confirmed: ${item.replace(/_/g, " ")}`)] : []),
    ...(hotel ? [hotel.disclosure, hotel.availabilityLabel] : []),
    ...presentation.details.assumptions, ...presentation.details.warnings, ...presentation.details.unknowns,
    ...presentation.rewards.scenarios.flatMap((scenario) => [...scenario.assumptions, ...scenario.warnings]),
  ])];
  return <div className="mt-6 space-y-8">
    {isPrevious ? <p className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 font-medium text-amber-100">Previous plan · These results stay here until an updated plan is saved successfully.</p> : null}
    {presentation.tripRealityCard ? <TripRealitySection card={presentation.tripRealityCard} /> : null}
    <section className="space-y-4" aria-label="Plan overview">
      <h3 className="text-xl font-semibold text-white">Plan overview</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${cardStyle} border-sky-400/40`}>
          <p className="text-sm text-sky-200">{flight ? "Flight · total searched-party price" : flightQuotes.length ? "Flight · exact cash quotes" : "Flight"}</p>
          {flight ? <><p className="mt-2 text-2xl font-semibold text-white">{flight.priceLabel}</p><p className="mt-2 text-sm text-slate-300">{flight.travelersLabel} · {flight.evidenceLabel}</p></> : flightQuotes.length ? <CashQuoteOverview quotes={flightQuotes} /> : <><p className="mt-2 text-2xl font-semibold text-white">Total not confirmed</p><p className="mt-2 text-sm text-slate-300">No flight cash estimate saved.</p></>}
        </div>
        <div className={cardStyle}>
          <p className="text-sm text-sky-200">{hotel ? "Hotels · whole-stay estimates" : hotelQuotes.length ? "Hotels · exact cash quotes" : "Hotels"}</p>
          {hotel ? <ul className="mt-2 space-y-4">{hotel.options.map((option) => <li key={option.key}><p className="font-medium text-white">{option.propertyName}</p><p className="mt-1 text-2xl font-semibold text-white">{option.totalPriceLabel ?? "Whole-stay total not confirmed"}</p><p className="mt-1 text-sm text-slate-300">{option.nightlyPriceLabel ?? "Nightly price not confirmed"}</p></li>)}</ul> : hotelQuotes.length ? <CashQuoteOverview quotes={hotelQuotes} /> : <p className="mt-2 text-2xl font-semibold text-white">Whole-stay total not confirmed</p>}
        </div>
      </div>
      <p className="text-sm text-slate-300">Saved goal: {presentation.goal.priority}{presentation.goal.nightsLabel ? ` · ${presentation.goal.nightsLabel}` : ""}{presentation.goal.budgetLabel ? ` · ${presentation.goal.budgetLabel}` : ""}</p>
      <div className="rounded-xl bg-sky-400/10 p-4"><h4 className="font-semibold text-sky-100">Next step: verify before booking</h4><p className="mt-1 text-sm leading-relaxed text-slate-200">Check the searched dates, traveler coverage, current prices, fees, and availability with the airline or property. Confirm reward balances before using points.</p></div>
    </section>

    <section className="space-y-4" aria-label="Flight result">
      <h3 className="text-xl font-semibold text-white">Flight result</h3>
      {flight ? <article className={`${cardStyle} border-sky-400/40`}>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h4 className="text-lg font-semibold text-white">{flight.route}</h4><p className="mt-1 text-slate-200">{flight.dates}</p></div><span className="rounded-full bg-amber-300/10 px-3 py-1 text-sm text-amber-200">{flight.verificationLabel}</span></div>
        <p className="mt-5 text-sm text-slate-300">Total searched-party price</p><p className="mt-1 text-3xl font-semibold text-white">{flight.priceLabel}</p>
        <p className="mt-2 text-sm text-slate-300">{flight.travelersLabel} · {flight.cabin} · {flight.evidenceLabel}</p>
        {flight.segments.length > 0 ? <ul className="mt-4 space-y-2 border-t border-slate-700 pt-4 text-sm text-slate-200">{flight.segments.map((segment, index) => <li key={index}>{segment}</li>)}</ul> : null}
        <p className="mt-4 text-xs text-slate-300">Retrieved {flight.retrievedAt}</p>
      </article> : flightQuotes.length || presentation.customerVerified.some((option) => option.kind === "flight") ? null : <p className="rounded-xl border border-slate-700 p-4 text-slate-300">No flight search estimate saved. Price and itinerary are not confirmed.</p>}
      <TravelEvidence presentation={presentation} kind="flight" />
    </section>

    <section className="space-y-4" aria-label="Hotel results">
      <h3 className="text-xl font-semibold text-white">Hotel results</h3>
      {hotel ? <>
        <p className="text-slate-200">{hotel.destination} · {hotel.dates}</p><p className="text-sm text-slate-300">{hotel.nights} nights · {hotel.travelersLabel} · {hotel.evidenceLabel}</p>
        <div className="grid gap-4 lg:grid-cols-2">{hotel.options.map((option) => <article key={option.key} className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
          <HotelImage option={option} />
          <div className="space-y-4 p-4 sm:p-6"><h4 className="text-lg font-semibold text-white">{option.propertyName}</h4>
            <dl className="space-y-3"><div><dt className="text-sm text-slate-300">Whole-stay total</dt><dd className="mt-1 text-2xl font-semibold text-white">{option.totalPriceLabel ?? "Whole-stay total not confirmed"}</dd></div><div><dt className="text-sm text-slate-300">Nightly price</dt><dd className="mt-1 font-medium text-slate-100">{option.nightlyPriceLabel ?? "Nightly price not confirmed"}</dd></div></dl>
            {option.ratingLabel ? <p className="text-sm text-slate-200">Guest rating: {option.ratingLabel}</p> : null}
            {option.hotelClassLabel ? <p className="text-sm text-slate-200">Hotel class: {option.hotelClassLabel}</p> : null}
            {option.neighborhoodLabel ? <p className="text-sm text-slate-300">{option.neighborhoodLabel}</p> : null}
            {option.amenities.length > 0 ? <ul className="flex flex-wrap gap-2">{option.amenities.map((amenity, index) => <li key={index} className="rounded-lg bg-slate-800 px-2 py-1 text-sm text-slate-200">{amenity}</li>)}</ul> : null}
            <p className="text-sm text-amber-200">{hotel.verificationLabel} · {option.trustStatusLabel}</p>
            {option.propertyUrl ? <a href={option.propertyUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex min-h-11 items-center rounded-lg border border-slate-500 px-3 text-sm font-medium text-sky-200 ${focusStyle}`}>Check {option.propertyName} details <span className="ml-1">(opens in new tab)</span></a> : <p className="text-sm text-slate-300">Property link unavailable. Check directly with the property.</p>}
          </div>
        </article>)}</div>
      </> : hotelQuotes.length || presentation.customerVerified.some((option) => option.kind === "hotel") ? null : <p className="rounded-xl border border-slate-700 p-4 text-slate-300">No hotel search estimate saved. Nightly prices and whole-stay totals are not confirmed.</p>}
      <TravelEvidence presentation={presentation} kind="hotel" />
    </section>

    <section className="space-y-4" aria-label="Rewards strategy and alternatives">
      <h3 className="text-xl font-semibold text-white">Rewards strategy and alternatives</h3>
      <p className="text-slate-300">{presentation.rewards.summary}</p>
      {presentation.earnPlan ? <Disclosure label="See how your rewards could grow before this trip">
        <ul className="space-y-3">
          {presentation.earnPlan.accounts.map((account) => <li key={account.key} className="rounded-lg bg-slate-800 p-4"><p className="font-medium text-white">{account.programName} · {account.ownerLabel}</p><p className="mt-1 text-sm text-slate-300">{account.balanceLabel}</p>{account.monthlyLabel ? <p className="mt-1 text-sm text-slate-200">{account.monthlyLabel}{account.projectedLabel ? ` · ${account.projectedLabel}` : ""}</p> : null}{account.contributingCardsLabel ? <p className="mt-1 text-sm text-slate-400">Based on: {account.contributingCardsLabel}</p> : null}</li>)}
        </ul>
        {presentation.earnPlan.tripCashLabel ? <p className="text-sm text-slate-200">{presentation.earnPlan.tripCashLabel}</p> : null}
        {presentation.earnPlan.cashGapLabel ? <p className="text-sm text-slate-200">{presentation.earnPlan.cashGapLabel}</p> : null}
        <p className="text-sm text-slate-400">{presentation.earnPlan.disclosure}</p>
        {presentation.earnPlan.warnings.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">{presentation.earnPlan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
      </Disclosure> : null}
      <Disclosure label="Review confirmed rewards and balances needing confirmation">
        {[{ label: "Confirmed rewards", accounts: presentation.rewards.verified }, { label: "Balances needing confirmation", accounts: presentation.rewards.unverified }].map((group) => <div key={group.label}><h4 className="font-semibold text-white">{group.label}</h4>{group.accounts.length ? <ul className="mt-3 space-y-3">{group.accounts.map((account) => <li key={account.key} className="rounded-lg bg-slate-800 p-4"><p className="font-medium text-white">{account.programName} · {points(account.balance)}</p><p className="mt-1 text-sm text-slate-300">{account.ownerLabel} · {account.verificationLabel} · {account.originLabel} · Balance as of {account.balanceAsOf}</p></li>)}</ul> : <p className="mt-2 text-sm text-slate-300">No accounts in this category.</p>}</div>)}
      </Disclosure>
      {presentation.rewards.scenarios.length > 0 ? <Disclosure label="Compare points requirements and reward-account allocations">
        {presentation.rewards.scenarios.map((scenario) => <article key={scenario.key} className="space-y-3 rounded-xl border border-slate-700 p-4"><h4 className="font-semibold text-white">{scenario.label}</h4><p className="text-sm text-amber-200">{scenario.statusLabel}</p><p className="text-sm text-slate-300">{scenario.title}</p>
          {scenario.flight ? <PointsEstimate estimate={scenario.flight} /> : null}{scenario.hotel ? <PointsEstimate estimate={scenario.hotel} /> : null}
          <ul className="space-y-2">{scenario.allocations.map((allocation) => <li key={allocation.key} className="rounded-lg bg-slate-800 p-3 text-sm text-slate-200">{allocation.programName} · {allocation.ownerLabel}<p className="mt-1">Planned: {points(allocation.plannedPoints)} · Gap: {points(allocation.pointsGap)}</p><p className="mt-1">{allocation.verificationLabel} · {allocation.fundingLabel}</p></li>)}</ul>
        </article>)}
      </Disclosure> : null}
      {presentation.flightEstimates.length > 0 ? <Disclosure label="Explore flight points estimates"><div className="grid gap-3 md:grid-cols-2">{presentation.flightEstimates.map((estimate) => <PointsEstimate key={estimate.key} estimate={estimate} />)}</div></Disclosure> : null}
      {presentation.hotelEstimates.length > 0 ? <Disclosure label="Explore hotel points estimates"><div className="grid gap-3 md:grid-cols-2">{presentation.hotelEstimates.map((estimate) => <PointsEstimate key={estimate.key} estimate={estimate} />)}</div></Disclosure> : null}
      {presentation.alternatives.map((alternative) => <article key={alternative.key} className={cardStyle}><h4 className="font-semibold text-white">{alternative.title}</h4><p className="mt-2 text-slate-300">{alternative.tradeoff}</p></article>)}
      {presentation.refinementTopics.length > 0 ? <Disclosure label="Fine-tune this plan"><ul className="list-disc space-y-2 pl-5 text-slate-300">{presentation.refinementTopics.map((topic, index) => <li key={index}>{topic}</li>)}</ul></Disclosure> : null}
    </section>

    <section className="space-y-3 border-t border-slate-700 pt-5 text-sm leading-relaxed text-slate-300" aria-label="Important details">
      <h3 className="font-semibold text-slate-200">Important details</h3>
      <p>{presentation.strategy.headline}. {presentation.strategy.summary}</p>
      <ul className="list-disc space-y-2 pl-5">{disclosures.map((item, index) => <li key={index}>{item}</li>)}</ul>
      {presentation.lastResearched && presentation.lastResearchedLabel ? <p>Last researched <time dateTime={presentation.lastResearched}>{presentation.lastResearchedLabel}</time></p> : null}
    </section>
  </div>;
}

export function GoalStrategyPanel({ goalId, goal, initialStrategy = null, initialGeneratedAt = null }: { goalId: string; goal: Goal; initialStrategy?: PersonalizedStrategy | null; initialGeneratedAt?: string | null }) {
  const [strategy, setStrategy] = useState<PersonalizedStrategy | null>(initialStrategy);
  const [generatedAt, setGeneratedAt] = useState<string | null>(() => normalizePersistedStrategyTimestamp(initialGeneratedAt));
  const [runState, setRunState] = useState<StrategyPanelRunState>(() => createInitialStrategyPanelRunState());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const presentation = strategy ? buildCustomerSafeStrategyPresentation(goal, strategy, generatedAt) : null;
  const trip = presentation?.goal ?? buildCustomerSafeGoalSummary(goal);
  const hasSavedStrategy = strategy !== null;
  const progress = buildStrategyProgressPresentation(runState, hasSavedStrategy);
  const previews = buildStrategyPreviewPresentation(runState, hasSavedStrategy);
  const failureMessage = runState.failure ? buildStrategyFailureMessage(runState.failure, hasSavedStrategy) : null;
  const retryAvailable = isStrategyRetryAvailable(runState);

  useEffect(() => { if (!runState.isGenerating && failureMessage) noticeRef.current?.focus(); }, [failureMessage, runState.isGenerating]);

  /** Applies a successful-finalization outcome; failures never reach this. */
  function applyFinalizationSucceeded(state: StrategyPanelRunState, finalized: { strategy: PersonalizedStrategy; generatedAt: string }) {
    const transition = transitionStrategyPanelRun(state, { type: "finalization_succeeded", strategy: finalized.strategy, generatedAt: finalized.generatedAt });
    if (transition.strategyUpdate) {
      const update = transition.strategyUpdate;
      setStrategy(update.strategy);
      setGeneratedAt((current) => transitionStrategyTimestamp(current, { type: "finalization_succeeded", generatedAt: update.generatedAt }));
    }
    setRunState(transition.state);
  }

  async function handleGenerate() {
    if (runState.isGenerating || isDeleting) return;
    setDeleteError(null);
    let state = transitionStrategyPanelRun(runState, { type: "run_started" }).state;
    setRunState(state);
    try {
      const flight = await generateGoalFlightStageAction(goalId);
      if (!flight.success) { setRunState(transitionStrategyPanelRun(state, { type: "flight_action_failed" }).state); return; }
      // success: true means the signed stage reached a valid terminal state;
      // stageStatus "failed" is a degraded lane that still yields a usable run.
      state = transitionStrategyPanelRun(state, { type: "flight_stage_completed", runId: flight.runId, stageStatus: flight.stageStatus, options: flight.options }).state;
      setRunState(state);
      const hotel = await generateGoalHotelStageAction(goalId, flight.runId);
      if (!hotel.success) { setRunState(transitionStrategyPanelRun(state, { type: "hotel_action_failed" }).state); return; }
      state = transitionStrategyPanelRun(state, { type: "hotel_stage_completed", stageStatus: hotel.stageStatus, options: hotel.options }).state;
      setRunState(state);
      const final = await finalizeGoalStrategyRunAction(goalId, flight.runId);
      if (!final.success) { setRunState(transitionStrategyPanelRun(state, { type: "finalization_failed", retryable: final.retryable === true }).state); return; }
      applyFinalizationSucceeded(state, { strategy: final.strategy, generatedAt: final.generatedAt });
    } catch {
      // Transport failure: stop all activity and fall back to the allowlisted
      // safe state for the stage whose action was executing. A finalization
      // transport exception conservatively retains the reusable run because
      // the existing server-validation design makes a repeated finalization
      // attempt demonstrably safe (failed→running only, verified server-side
      // stages, no research rerun, saved strategy replaced only on successful
      // persistence, and non-retryable results clear the run).
      if (state.stage === "final") setRunState(transitionStrategyPanelRun(state, { type: "finalization_transport_exception" }).state);
      else if (state.stage === "hotel") setRunState(transitionStrategyPanelRun(state, { type: "hotel_action_failed" }).state);
      else setRunState(transitionStrategyPanelRun(state, { type: "flight_action_failed" }).state);
    }
  }

  async function handleRetry() {
    if (runState.isGenerating || isDeleting || !isStrategyRetryAvailable(runState)) return;
    const retainedRunId = runState.runId;
    if (!retainedRunId) return;
    const state = transitionStrategyPanelRun(runState, { type: "retry_started" }).state;
    setRunState(state);
    try {
      // Finalization-only retry: only goalId and the existing signed runId.
      // Flight and hotel research are never rerun from this control.
      const result = await finalizeGoalStrategyRunAction(goalId, retainedRunId);
      if (!result.success) { setRunState(transitionStrategyPanelRun(state, { type: "finalization_failed", retryable: result.retryable === true }).state); return; }
      applyFinalizationSucceeded(state, { strategy: result.strategy, generatedAt: result.generatedAt });
    } catch {
      setRunState(transitionStrategyPanelRun(state, { type: "finalization_transport_exception" }).state);
    }
  }

  async function handleDelete() {
    if (!strategy || runState.isGenerating || isDeleting) return;
    const confirmed = window.confirm(
      "Delete this saved strategy? This removes the saved plan. You can build a new plan later.",
    );
    if (!confirmed) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteGoalStrategyAction(goalId);
      if (!result.success) {
        setDeleteError("We couldn’t delete your strategy right now. Your saved plan is unchanged.");
        return;
      }
      setStrategy(null);
      setGeneratedAt(null);
      setRunState(createInitialStrategyPanelRunState());
    } catch {
      setDeleteError("We couldn’t delete your strategy right now. Your saved plan is unchanged.");
    } finally {
      setIsDeleting(false);
    }
  }

  return <div className="mt-6 min-w-0 border-t border-slate-700 pt-6 [overflow-wrap:anywhere]">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-semibold text-white">{trip.title}</h2><span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-medium text-slate-200">{trip.status}</span></div><p className="mt-3 text-lg text-white">{trip.route}</p><p className="mt-1 text-slate-200">{trip.dateWindow ?? "Travel dates not confirmed"}</p><p className="mt-2 text-sm text-slate-300">{trip.travelerLabel} · {trip.cabin}</p></div>
      <button type="button" onClick={handleGenerate} disabled={runState.isGenerating || isDeleting} className={`fb-btn inline-flex min-h-11 shrink-0 items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}><Sparkles aria-hidden="true" className="h-4 w-4" />{strategy ? "Refresh plan" : "Build my plan"}</button>
    </header>
    <div role="status" aria-live="polite" aria-atomic="true" className="mt-4">
    {progress ? <div className="mt-6 rounded-2xl border border-sky-400/30 bg-sky-400/10 p-4 sm:p-6">
      <p className="flex items-center gap-2 font-semibold text-white"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />{progress.heading}</p><p className="mt-2 text-sm text-slate-300">{progress.description}</p>
      <ol className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[
        { stage: "flight", label: "Searching flights", status: runState.flightStageStatus },
        { stage: "hotel", label: "Searching hotels", status: runState.hotelStageStatus },
        { stage: "final", label: "Building plan", status: null },
        { stage: "ready", label: "Ready", status: null },
      ].map((step) => <li key={step.stage} aria-current={runState.stage === step.stage ? "step" : undefined} className={`rounded-lg border p-3 ${runState.stage === step.stage ? "border-sky-300 bg-sky-300/10 text-white" : "border-slate-600 text-slate-300"}`}><span className="font-medium">{step.label}</span><span className="mt-1 block text-xs">{runState.stage === step.stage ? "In progress" : step.status === "failed" ? "No usable estimates" : step.status === "succeeded" ? "Search complete" : "Pending"}</span></li>)}</ol>
    </div> : <p className="text-sm font-medium text-sky-200">{failureMessage ? (hasSavedStrategy ? "Plan update failed. Your previous saved plan is unchanged." : "Plan generation failed. Review the recovery options below.") : savedResultStatus(presentation)}</p>}
    </div>
    {previews.mode === "active" ? <div className="mt-4 space-y-3"><StagedPreviewLists flightOptions={runState.flightOptions} hotelOptions={runState.hotelOptions} /></div> : null}
    {previews.mode === "retained" ? <div className="mt-4 space-y-2"><p className="text-sm text-slate-300">{previews.heading}</p><StagedPreviewLists flightOptions={runState.flightOptions} hotelOptions={runState.hotelOptions} /></div> : null}
    {failureMessage ? <div ref={noticeRef} tabIndex={-1} className={`mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 ${focusStyle}`}><p className="text-sm text-amber-100">{failureMessage}</p>{retryAvailable ? <button type="button" className={`mt-3 min-h-11 rounded-lg border border-amber-400/40 px-3 text-sm text-amber-100 ${focusStyle}`} onClick={handleRetry} disabled={runState.isGenerating}>Try finishing again</button> : null}</div> : null}
    {deleteError ? <div role="alert" className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-3"><p className="text-sm text-rose-100">{deleteError}</p></div> : null}
    {presentation ? <PlanResults presentation={presentation} isPrevious={runState.isGenerating || runState.failure !== null} /> : !progress && !failureMessage ? <p className="mt-4 text-slate-300">Build a plan using your saved trip details to explore flight, hotel, and rewards estimates.</p> : null}
    {strategy ? <div className="mt-6 border-t border-slate-700 pt-4"><button type="button" onClick={handleDelete} disabled={runState.isGenerating || isDeleting} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 ${focusStyle}`}>{isDeleting ? <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Deleting…</> : <><Trash2 aria-hidden="true" className="h-4 w-4" />Delete strategy</>}</button></div> : null}
  </div>;
}
