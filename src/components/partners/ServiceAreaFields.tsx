/**
 * Where a partner sells and rents (14 Oct 2026, owner's request): all over
 * India by courier, or only to readers within a chosen distance of the
 * partner's Google pin. The server checks the same rules
 * (cleanPartnerServiceArea_ in appsscript.js) and refuses requests from
 * readers outside the circle.
 */
export const RADIUS_CHOICES_KM = [2, 5, 10, 15, 25, 50, 100];

export type ServiceArea = { serviceArea: 'india' | 'nearby'; serviceRadiusKm: number };

export default function ServiceAreaFields({ value, onChange, error, hasPin }: {
  value: ServiceArea; onChange: (v: ServiceArea) => void; error?: string; hasPin: boolean;
}) {
  return (
    <div className="pp-field" role="radiogroup" aria-label="Who can buy or rent from you" data-testid="partner-service-area">
      <label className="pp-check">
        <input type="radio" name="pp-serviceArea" checked={value.serviceArea === 'india'} onChange={() => onChange({ ...value, serviceArea: 'india' })} />
        {' '}Readers all over India — I ship by courier
      </label>
      <label className="pp-check">
        <input type="radio" name="pp-serviceArea" checked={value.serviceArea === 'nearby'} onChange={() => onChange({ ...value, serviceArea: 'nearby' })} />
        {' '}Only readers near me
      </label>
      {value.serviceArea === 'nearby' && (
        <label className="pp-field">
          <span className="pp-label">Up to how far? *</span>
          <select className="input-classic pp-input" name="serviceRadiusKm" value={value.serviceRadiusKm}
            onChange={(e) => onChange({ ...value, serviceRadiusKm: Number(e.target.value) })}>
            {RADIUS_CHOICES_KM.map((k) => <option key={k} value={k}>Within {k} km</option>)}
          </select>
          <span className="pp-hint">
            Measured from your Google pin{hasPin ? '' : ' — pin your location on Google Maps for this'}. Readers farther away see your books but cannot request them.
          </span>
        </label>
      )}
      {error && <span className="pp-error" role="alert">{error}</span>}
    </div>
  );
}
