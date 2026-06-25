import { useCallback, useRef, useState } from "react";
import {
  GoogleMap,
  Marker,
  Autocomplete,
  useJsApiLoader,
} from "@react-google-maps/api";
import { Input } from "./ui/input";

const libraries: "places"[] = ["places"];
const mapContainerStyle = {
  width: "100%",
  height: "200px",
  borderRadius: 12,
  marginTop: 8,
};
const defaultCenter = { lat: 1.3521, lng: 103.8198 }; // Singapore fallback

export type AddressSelection = {
  formattedAddress: string;
  lat: number;
  lng: number;
  postalCode: string;
};

// Restrict predictions to Singapore (req 1) and ask only for the fields we read.
const autocompleteRestrictions = { country: "sg" as const };
const autocompleteFields = [
  "formatted_address",
  "address_components",
  "geometry",
  "name",
];

// A Singapore address is uniquely identified by a 6-digit postal code.
const SG_POSTAL = /^\d{6}$/;

export function AddressPicker({
  value,
  onChange,
  onSelect,
  onValidChange,
  error,
  placeholder = "Street address",
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect?: (selection: AddressSelection) => void;
  // Reports whether `value` is a confirmed SG address with a 6-digit postal code.
  onValidChange?: (valid: boolean, details?: AddressSelection) => void;
  error?: boolean;
  placeholder?: string;
}) {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries,
  });

  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const onPlaceChanged = useCallback(async () => {
    const place = autocompleteRef.current?.getPlace();
    if (!place?.geometry?.location) {
      onValidChange?.(false);
      return;
    }

    const location = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    const formattedAddress = place.formatted_address ?? "";
    // A valid SG location is uniquely identified by its 6-digit postal code.
    const postalComponent = (place.address_components ?? []).find((c) =>
      c.types.includes("postal_code"),
    );
    const postalCode = postalComponent?.long_name ?? "";
    const valid = SG_POSTAL.test(postalCode);

    setMarker(location);
    const fullAddress = await resolveFullAddress(place, location, formattedAddress, postalCode);
    onChange(fullAddress);
    const selection = { formattedAddress: fullAddress, postalCode, ...location };
    onSelect?.(selection);
    onValidChange?.(valid, valid ? selection : undefined);
  }, [onChange, onSelect, onValidChange]);

  // Manual typing can't be a confirmed place, so it's invalid until a suggestion
  // (with a 6-digit postal code) is picked from the dropdown.
  const handleType = useCallback(
    (text: string) => {
      onChange(text);
      onValidChange?.(false);
    },
    [onChange, onValidChange],
  );

  if (!isLoaded) {
    // Maps unavailable: keep it usable but still only treat text with a 6-digit
    // postal code as a valid address.
    return (
      <Input
        value={value}
        onChange={(e) => {
          const text = e.target.value;
          onChange(text);
          onValidChange?.(/\b\d{6}\b/.test(text));
        }}
        placeholder={placeholder}
        style={error ? { borderColor: "#ff3354" } : undefined}
      />
    );
  }

  return (
    <div>
      <Autocomplete
        onLoad={(autocomplete) => {
          autocompleteRef.current = autocomplete;
        }}
        onPlaceChanged={onPlaceChanged}
        restrictions={autocompleteRestrictions}
        fields={autocompleteFields}
      >
        <Input
          value={value}
          onChange={(e) => handleType(e.target.value)}
          placeholder={placeholder}
          style={error ? { borderColor: "#ff3354" } : undefined}
        />
      </Autocomplete>

      {marker && (
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          center={marker}
          zoom={15}
        >
          <Marker position={marker} />
        </GoogleMap>
      )}
    </div>
  );
}

function component(
  components: google.maps.GeocoderAddressComponent[] | undefined,
  type: string,
): string {
  return components?.find((c) => c.types.includes(type))?.long_name ?? "";
}

function hasStreetLevelAddress(text: string): boolean {
  return /\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|way|walk|crescent|cres|boulevard|blvd|jalan)\b/i.test(text);
}

async function resolveFullAddress(
  place: google.maps.places.PlaceResult,
  location: { lat: number; lng: number },
  formattedAddress: string,
  postalCode: string,
): Promise<string> {
  if (formattedAddress && hasStreetLevelAddress(formattedAddress)) return formattedAddress;

  const street = [component(place.address_components, "street_number"), component(place.address_components, "route")]
    .filter(Boolean)
    .join(" ");
  const postal = postalCode ? `Singapore ${postalCode}` : component(place.address_components, "country");
  const localParts = [place.name, street, postal].filter((part, index, arr) => {
    const clean = String(part ?? "").trim();
    return clean && arr.findIndex((candidate) => String(candidate ?? "").trim().toLowerCase() === clean.toLowerCase()) === index;
  });
  const composed = localParts.join(", ");
  if (composed && hasStreetLevelAddress(composed)) return composed;

  if (window.google?.maps?.Geocoder) {
    try {
      const geocoder = new window.google.maps.Geocoder();
      const response = await geocoder.geocode({ location });
      const streetResult = response.results.find((result) => hasStreetLevelAddress(result.formatted_address));
      if (streetResult?.formatted_address) {
        const name = place.name?.trim();
        if (name && !streetResult.formatted_address.toLowerCase().includes(name.toLowerCase())) {
          return `${name}, ${streetResult.formatted_address}`;
        }
        return streetResult.formatted_address;
      }
    } catch {
      // Keep the local fallback when reverse geocoding is unavailable.
    }
  }

  return composed || formattedAddress;
}
