import importlib.util
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location("brainstorm_dev", Path(__file__).with_name("dev.py"))
dev = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = dev
spec.loader.exec_module(dev)


class LauncherTests(unittest.TestCase):
    def test_detection_ignores_shell_mentions_and_other_checkouts(self):
        worker = next(service for service in dev.services() if service.name == "worker")
        command = " ".join(worker.command)
        self.assertTrue(dev.matches(worker, command))
        self.assertFalse(dev.matches(worker, "/bin/zsh -c '" + command + "'"))
        self.assertFalse(dev.matches(worker, command.replace(str(dev.ROOT), "/tmp/another-checkout")))

    def test_multiple_workers_are_rejected(self):
        worker = next(service for service in dev.services() if service.name == "worker")
        with self.assertRaisesRegex(RuntimeError, "Multiple worker"):
            dev.find_process(worker, {100: " ".join(worker.command), 200: " ".join(worker.command)})

    def test_separate_preview_port_is_not_the_live_frontend(self):
        frontend = dev.services()[-1]
        command = f"node {dev.ROOT}/frontend/node_modules/.bin/vite --host 127.0.0.1"
        self.assertTrue(dev.matches(frontend, command))
        self.assertTrue(dev.matches(frontend, command + " --port 5173"))
        self.assertFalse(dev.matches(frontend, command + " --port 5174"))
        self.assertFalse(dev.matches(frontend, command + " --port=5174"))

    def test_reuses_existing_service_without_spawning_or_taking_ownership(self):
        service = dev.services()[0]
        owned = {}
        with patch.object(dev, "healthy", return_value=True), patch.object(dev.subprocess, "Popen") as spawn:
            pid = dev.start_service(service, {100: " ".join(service.command)}, owned)
        self.assertEqual(pid, 100)
        self.assertEqual(owned, {})
        spawn.assert_not_called()

    def test_occupied_port_cannot_start_a_duplicate_server(self):
        with patch.object(dev, "port_in_use", return_value=True), patch.object(dev.subprocess, "Popen") as spawn:
            with self.assertRaisesRegex(RuntimeError, "occupied"):
                dev.start_service(dev.services()[0], {}, {})
        spawn.assert_not_called()

    def test_new_worker_is_owned_and_uses_the_same_checkout(self):
        service = next(service for service in dev.services() if service.name == "worker")
        process = Mock(pid=200)
        process.poll.return_value = None
        owned = {}
        with tempfile.TemporaryDirectory() as directory, patch.object(dev, "RUNTIME", Path(directory)), \
                patch.object(dev.subprocess, "Popen", return_value=process) as spawn:
            self.assertEqual(dev.start_service(service, {}, owned), 200)
        self.assertIs(owned["worker"], process)
        self.assertEqual(spawn.call_args.kwargs["cwd"], dev.ROOT)
        self.assertTrue(spawn.call_args.kwargs["start_new_session"])

    def test_early_exit_is_reported(self):
        process = Mock(pid=200)
        process.poll.return_value = 1
        service = next(service for service in dev.services() if service.name == "worker")
        with tempfile.TemporaryDirectory() as directory, patch.object(dev, "RUNTIME", Path(directory)), \
                patch.object(dev.subprocess, "Popen", return_value=process):
            with self.assertRaisesRegex(RuntimeError, "worker exited"):
                dev.start_service(service, {}, {})

    def test_shutdown_signals_only_processes_started_by_launcher(self):
        alive, exited = Mock(pid=100), Mock(pid=200)
        alive.poll.return_value = None
        exited.poll.return_value = 0
        with patch.object(dev.os, "killpg") as kill:
            dev.stop_owned({"worker": alive, "frontend": exited})
        kill.assert_called_once_with(100, signal.SIGTERM)
        alive.wait.assert_called_once()

    def test_status_fails_when_worker_missing_even_with_healthy_http_services(self):
        stack = dev.services()
        table = {i + 100: " ".join(service.command) for i, service in enumerate(stack) if service.name != "worker"}
        with patch.object(dev, "process_table", return_value=table), \
                patch.object(dev, "healthy", return_value=True), patch.object(dev, "check_routes"), \
                patch.object(dev, "get_json", return_value={"jobs": []}):
            self.assertEqual(dev.status(stack), 1)

    def test_supervisor_reports_exit_and_cleans_up(self):
        service = next(service for service in dev.services() if service.name == "worker")
        with tempfile.TemporaryDirectory() as directory, patch.object(dev, "RUNTIME", Path(directory)), \
                patch.object(dev, "preflight"), patch.object(dev, "check_routes"), \
                patch.object(dev, "start_service", return_value=100), \
                patch.object(dev, "process_table", side_effect=[{100: " ".join(service.command)}, {}]), \
                patch.object(dev.time, "sleep"), patch.object(dev, "stop_owned") as cleanup:
            with self.assertRaisesRegex(RuntimeError, "worker stopped"):
                dev.run([service])
        cleanup.assert_called_once_with({})


if __name__ == "__main__":
    unittest.main()
