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
};

export function AddressPicker({
  value,
  onChange,
  onSelect,
  error,
  placeholder = "Street address",
}: {
  value: string;
  onChange: (text: string) => void;
  onSelect?: (selection: AddressSelection) => void;
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
    if (!place?.geometry?.location) return;

    const location = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    const formattedAddress = place.formatted_address ?? "";

    setMarker(location);
    onChange(formattedAddress);
    onSelect?.({ formattedAddress, ...location });
  }, [onChange, onSelect]);

  if (!isLoaded) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
      >
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
