import { useEffect, useRef, useState } from "react";
import { queryGeology, type GeologicalUnit } from "../geology";
import { classifyLithologies, fetchLithologyDictionary, type LithologyDictionary } from "../lithology";
import { classifyGeologicEra } from "../geologicTime";

export type QueryStatus = "idle" | "loading" | "success" | "empty" | "error";
export type Coordinates = { latitude: number; longitude: number };

/** Point query of Macrostrat map units, with the official lithology lexicon. */
export function useGeologyQuery() {
  const controllerRef = useRef<AbortController | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [units, setUnits] = useState<GeologicalUnit[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState<QueryStatus>("idle");
  const [dictionary, setDictionary] = useState<LithologyDictionary | null>(null);
  const [lexiconStatus, setLexiconStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const unit = units[selectedIndex] ?? null;

  const query = (latitude: number, longitude: number) => {
    setCoordinates({ latitude, longitude });
    setUnits([]);
    setSelectedIndex(0);
    setStatus("loading");
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    void queryGeology(latitude, longitude, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setUnits(result);
        setStatus(result.length ? "success" : "empty");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
  };

  useEffect(() => () => controllerRef.current?.abort(), []);

  // An unavailable lexicon must never hide valid map-unit data.
  // Fetch once and cache; no automatic classification from free-text guesses.
  useEffect(() => {
    if (status !== "success" || dictionary || !units.some((u) => u.lithIds.length > 0)) return;
    let active = true;
    setLexiconStatus("loading");
    void fetchLithologyDictionary()
      .then((dict) => {
        if (!active) return;
        setDictionary(dict);
        setLexiconStatus("ready");
      })
      .catch(() => {
        if (active) setLexiconStatus("error");
      });
    return () => { active = false; };
  }, [status, units, dictionary]);

  return {
    coordinates, units, unit, selectedIndex, setSelectedIndex, status, lexiconStatus, query,
    rockInfo: classifyLithologies(unit?.lithIds ?? [], dictionary),
    eraInfo: classifyGeologicEra(unit?.youngAgeMa ?? null, unit?.oldAgeMa ?? null),
  };
}
