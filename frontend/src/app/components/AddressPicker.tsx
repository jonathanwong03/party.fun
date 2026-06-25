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

  const onPlaceChanged = useCallback(() => {
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
    onChange(formattedAddress);
    const selection = { formattedAddress, postalCode, ...location };
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
