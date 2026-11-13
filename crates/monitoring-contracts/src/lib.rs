//! Shared metric definitions and sampling intervals for CyberOS monitoring daemons.
//!
//! The embedded catalog is shared with TypeScript. Durations use [`Duration`];
//! [`SamplingIntervals::validate`] checks bounds and cadence ordering before use.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;

/// Version of the metrics database schema, separate from the application database.
pub const METRICS_SCHEMA_VERSION: i64 = 1;
/// Product identity used to reject incompatible metrics databases.
pub const METRICS_SCHEMA_IDENTITY: &str = "cyberos-2.0";

/// Determines how samples are interpreted by queries and alert rules.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MetricKind {
    /// A sampled value that may increase or decrease.
    Gauge,
    /// An accumulated value whose resets are handled by rate calculations.
    Counter,
}

/// Sampling class used to choose a metric's collection interval.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MetricCadence {
    /// Rapidly changing host measurements.
    Fast,
    /// Filesystem, service and application measurements.
    Standard,
    /// Slowly changing thermal measurements.
    Temperature,
}

/// One metric's wire identity, labels, unit and sampling class.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    /// Stable name shared by storage, query and alert consumers.
    pub name: String,
    /// Human-readable meaning of the measurement.
    pub description: String,
    /// Interpretation as an instantaneous value or accumulated counter.
    pub kind: MetricKind,
    /// Unit recorded by the language-neutral catalog, such as bytes or seconds.
    pub unit: String,
    /// Allowed label names; label values identify the sampled resource.
    pub label_keys: Vec<String>,
    /// Collection schedule selected from the validated intervals.
    pub cadence: MetricCadence,
}

/// Collection durations ordered from fast to standard to temperature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SamplingIntervals {
    /// Fast sampling interval, between one second and five minutes.
    pub fast: Duration,
    /// Standard interval, at least `fast` and at most fifteen minutes.
    pub standard: Duration,
    /// Thermal interval, at least `standard` and at most one hour.
    pub temperature: Duration,
}

impl SamplingIntervals {
    /// Validates bounds in fast, standard, then temperature order.
    ///
    /// # Errors
    /// Returns the first invalid cadence when its duration is outside its bounds
    /// or shorter than the preceding cadence.
    pub fn validate(self) -> Result<Self, SamplingIntervalsError> {
        if !(Duration::from_secs(1)..=Duration::from_secs(5 * 60)).contains(&self.fast) {
            return Err(SamplingIntervalsError::Fast);
        }
        if self.standard < self.fast || self.standard > Duration::from_secs(15 * 60) {
            return Err(SamplingIntervalsError::Standard);
        }
        if self.temperature < self.standard || self.temperature > Duration::from_secs(60 * 60) {
            return Err(SamplingIntervalsError::Temperature);
        }
        Ok(self)
    }

    /// Returns the configured duration without performing validation.
    #[must_use]
    pub fn for_cadence(self, cadence: MetricCadence) -> Duration {
        match cadence {
            MetricCadence::Fast => self.fast,
            MetricCadence::Standard => self.standard,
            MetricCadence::Temperature => self.temperature,
        }
    }
}

impl Default for SamplingIntervals {
    fn default() -> Self {
        Self {
            fast: Duration::from_secs(10),
            standard: Duration::from_secs(30),
            temperature: Duration::from_secs(5 * 60),
        }
    }
}

/// The first cadence whose bounds or relative ordering failed validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SamplingIntervalsError {
    /// Fast sampling is outside its supported range.
    Fast,
    /// Standard sampling is too short or exceeds its supported range.
    Standard,
    /// Thermal sampling is too short or exceeds its supported range.
    Temperature,
}

impl SamplingIntervalsError {
    /// Returns the persistent settings key corresponding to this cadence.
    #[must_use]
    pub const fn field(self) -> &'static str {
        match self {
            Self::Fast => "fast_sample_interval_ms",
            Self::Standard => "standard_sample_interval_ms",
            Self::Temperature => "temperature_sample_interval_ms",
        }
    }
}

impl std::fmt::Display for SamplingIntervalsError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "invalid monitoring setting {}", self.field())
    }
}

impl std::error::Error for SamplingIntervalsError {}

static CATALOG: OnceLock<Vec<MetricDefinition>> = OnceLock::new();
static BY_NAME: OnceLock<HashMap<String, usize>> = OnceLock::new();

/// Returns metric definitions from the embedded, language-neutral catalog.
///
/// # Panics
/// Panics if the catalog embedded at compile time is invalid JSON.
#[must_use]
pub fn catalog() -> &'static [MetricDefinition] {
    CATALOG
        .get_or_init(|| {
            serde_json::from_str(include_str!(
                "../../../packages/monitoring/contracts/metrics-catalog.json"
            ))
            .expect("embedded monitoring catalog must be valid")
        })
        .as_slice()
}

/// Looks up a stable metric name, returning `None` for unknown names.
///
/// # Panics
/// Panics if the catalog embedded at compile time is invalid JSON.
#[must_use]
pub fn metric(name: &str) -> Option<&'static MetricDefinition> {
    let by_name = BY_NAME.get_or_init(|| {
        catalog()
            .iter()
            .enumerate()
            .map(|(index, definition)| (definition.name.clone(), index))
            .collect()
    });
    by_name.get(name).map(|index| &catalog()[*index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_the_language_neutral_catalog() {
        let definition = metric("cyberos_host_filesystem_used_ratio").unwrap();
        assert_eq!(definition.label_keys, ["filesystem"]);
        assert_eq!(catalog().len(), 29);
    }

    #[test]
    fn validates_sampling_interval_order_and_bounds() {
        assert!(SamplingIntervals::default().validate().is_ok());
        assert_eq!(
            SamplingIntervals {
                fast: Duration::from_millis(999),
                ..SamplingIntervals::default()
            }
            .validate(),
            Err(SamplingIntervalsError::Fast)
        );
        assert_eq!(
            SamplingIntervals {
                standard: Duration::from_secs(5),
                ..SamplingIntervals::default()
            }
            .validate(),
            Err(SamplingIntervalsError::Standard)
        );
    }
}
