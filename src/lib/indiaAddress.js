const PINCODE_REGEX = /^\d{6}$/;

const STATE_ALIASES = {
  "nct of delhi": "delhi",
  "national capital territory of delhi": "delhi",
  orissa: "odisha",
  pondicherry: "puducherry",
};

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLocationName(value) {
  const normalized = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return STATE_ALIASES[normalized] || normalized;
}

function uniqueNormalized(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const cleaned = normalizeWhitespace(value);
    const normalized = normalizeLocationName(cleaned);

    if (!cleaned || !normalized || normalized === "na") {
      continue;
    }

    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(cleaned);
    }
  }

  return result;
}

function isMatch(expectedValue, candidateValues) {
  const expected = normalizeLocationName(expectedValue);
  if (!expected) return true;

  return candidateValues.some((candidate) => normalizeLocationName(candidate) === expected);
}

export async function lookupIndianPincode(rawPincode) {
  const pincode = String(rawPincode || "").trim();

  if (!PINCODE_REGEX.test(pincode)) {
    return {
      success: false,
      code: "INVALID_PINCODE",
      error: "PIN code must be exactly 6 digits.",
    };
  }

  let response;
  try {
    response = await fetch(`https://apiv2.shiprocket.in/v1/external/open/postcode/details?postcode=${encodeURIComponent(pincode)}`, {
      cache: "no-store",
    });
  } catch (error) {
    return {
      success: false,
      code: "PINCODE_LOOKUP_FAILED",
      error: "Unable to verify PIN code right now. Please try again.",
      details: error.message,
    };
  }

  if (!response.ok) {
    return {
      success: false,
      code: "PINCODE_LOOKUP_FAILED",
      error: "Unable to verify PIN code right now. Please try again.",
      details: `Shiprocket postcode lookup failed with status ${response.status}`,
    };
  }

  const payload = await response.json();
  const postcodeDetails = payload?.postcode_details || null;

  if (!payload?.success || !postcodeDetails) {
    return {
      success: false,
      code: "PINCODE_NOT_FOUND",
      error: "We could not find this PIN code. Please check and try again.",
    };
  }

  const state = normalizeWhitespace(postcodeDetails.state);
  const stateCode = normalizeWhitespace(postcodeDetails.state_code).toUpperCase();
  const district = normalizeWhitespace(postcodeDetails.city);
  const country = normalizeWhitespace(postcodeDetails.country) || "India";
  const localityOptions = uniqueNormalized(
    Array.isArray(postcodeDetails.locality) ? postcodeDetails.locality : []
  );
  const cityOptions = uniqueNormalized([district]);
  const normalizedPostOffices = localityOptions.map((locality) => ({
    name: locality,
    district,
    state,
    stateCode,
    country,
    block: district,
    branchType: "",
    deliveryStatus: "",
  }));

  return {
    success: true,
    pincode,
    state,
    stateCode,
    district,
    cityOptions,
    localityOptions,
    suggestedCity: cityOptions[0] || district,
    suggestedAddressLine2: localityOptions[0] || "",
    postOffices: normalizedPostOffices,
  };
}

export function validatePincodeAgainstLocation(lookupResult, city, state) {
  if (!lookupResult?.success) {
    return {
      valid: false,
      code: lookupResult?.code || "PINCODE_NOT_FOUND",
      error: lookupResult?.error || "Unable to validate PIN code.",
    };
  }

  const stateCandidates = [lookupResult.state];
  const cityCandidates = lookupResult.cityOptions?.length
    ? lookupResult.cityOptions
    : [lookupResult.suggestedCity, lookupResult.district];

  if (!isMatch(state, stateCandidates)) {
    return {
      valid: false,
      code: "PINCODE_STATE_MISMATCH",
      error: `PIN code ${lookupResult.pincode} does not match the selected state.`,
    };
  }

  if (!isMatch(city, cityCandidates)) {
    return {
      valid: false,
      code: "PINCODE_CITY_MISMATCH",
      error: `PIN code ${lookupResult.pincode} does not match the selected city.`,
    };
  }

  return { valid: true };
}

export { PINCODE_REGEX, normalizeLocationName, normalizeWhitespace };