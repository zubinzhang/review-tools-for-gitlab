import { AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import * as vscode from 'vscode';
import { NodeObservabilityService } from './node_observability_service';

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}));

jest.mock('@opentelemetry/sdk-trace', () => ({
  BatchSpanProcessor: jest.fn(),
}));

jest.mock('../../common/observability', () => ({
  FallibleMetricExporter: jest.fn().mockImplementation(inner => inner),
  FallibleSpanExporter: jest.fn().mockImplementation(inner => inner),
}));

jest.mock('../language_server/get_client_context', () => ({
  getClientContext: jest.fn().mockReturnValue({
    ide: { name: 'Visual Studio Code', vendor: 'Microsoft Corporation', version: '1.0.0' },
    extension: { name: 'GitLab', version: '1.0.0' },
  }),
}));

jest.mock('../../common/log');

const OTLPMetricExporterMock = OTLPMetricExporter as jest.MockedClass<typeof OTLPMetricExporter>;

describe('NodeObservabilityService', () => {
  let service: NodeObservabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled = true;
    service = new NodeObservabilityService();
  });

  describe('initialize', () => {
    it('configures the metric exporter with delta aggregation temporality', async () => {
      await service.initialize();

      expect(OTLPMetricExporterMock).toHaveBeenCalledTimes(1);
      expect(OTLPMetricExporterMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temporalityPreference: AggregationTemporality.DELTA,
        }),
      );
    });

    it('disables OTel logs so the SDK does not build a log exporter from env vars', async () => {
      await service.initialize();

      expect(NodeSDK).toHaveBeenCalledWith(expect.objectContaining({ logRecordProcessors: [] }));
    });

    it('does not initialize the SDK when telemetry is disabled', async () => {
      (vscode.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled = false;

      await service.initialize();

      expect(OTLPMetricExporterMock).not.toHaveBeenCalled();
    });
  });
});
